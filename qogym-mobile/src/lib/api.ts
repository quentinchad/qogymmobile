import { API_URL } from '@/theme';

/**
 * Client HTTP de l'API PHP existante (https://qojim.com/qogym-api).
 * Mêmes endpoints, mêmes paramètres que le site web : la base de données et
 * le backend ne sont pas modifiés.
 */

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, data: any, message?: string) {
    super(message || data?.error || `Erreur ${status}`);
    this.status = status;
    this.data = data;
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setAuthToken = (t: string | null) => {
  authToken = t;
};
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

type Body = Record<string, any> | FormData | undefined;

async function request<T = any>(method: string, path: string, body?: Body, timeoutMs = 20000): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let payload: any = undefined;
  if (body instanceof FormData) {
    payload = body; // le Content-Type multipart (boundary) est posé par fetch
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal: ctrl.signal });
  } catch (e: any) {
    throw new ApiError(0, null, e?.name === 'AbortError' ? 'Le serveur ne répond pas' : 'Pas de connexion internet');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text?.slice(0, 200) };
  }
  if (!res.ok) {
    if (res.status === 401 && authToken && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data as T;
}

const get = <T = any>(p: string) => request<T>('GET', p);
const post = <T = any>(p: string, b?: Body) => request<T>('POST', p, b);
const put = <T = any>(p: string, b?: Body) => request<T>('PUT', p, b);
const del = <T = any>(p: string, b?: Body) => request<T>('DELETE', p, b);
const q = encodeURIComponent;

export const errMsg = (e: any, fallback = 'Une erreur est survenue') =>
  (e instanceof ApiError ? e.data?.error || e.message : e?.message) || fallback;

// ── Auth ────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) => post('/auth.php', { action: 'login', email, password }),
  register: (email: string, username: string, password: string) =>
    post('/auth.php', { action: 'register', email, username, password }),
  logout: () => post('/auth.php', { action: 'logout' }),
  me: () => get('/auth.php'),
  changePassword: (current_password: string, new_password: string) =>
    post('/auth.php', { action: 'change_password', current_password, new_password }),
  changeUsername: (username: string) => post('/auth.php', { action: 'change_username', username }),
  resendVerification: (email: string) => post('/auth.php', { action: 'resend_verification', email }),
  requestPasswordReset: (email: string) => post('/password_reset', { action: 'request_reset', email }),
};

// ── Séances ─────────────────────────────────────────────────────────────
export const sessionApi = {
  list: () => get('/sessions.php'),
  get: (id: number | string) => get(`/sessions.php?id=${id}`),
  types: () => get('/sessions.php?types=1'),
  allExercises: () => get('/sessions.php?all_exercises=1'),
  searchExternal: (term: string) => get(`/sessions.php?external_exercise_search=1&term=${q(term)}`),
  create: (fd: FormData) => post('/sessions.php', fd),
  update: (fd: FormData) => {
    fd.append('_method', 'PUT');
    return post('/sessions.php', fd);
  },
  patch: (id: number | string, fields: Record<string, any>) => put('/sessions.php', { id, ...fields }),
  remove: (id: number | string) => del('/sessions.php', { id }),
};

export const qojimApi = {
  list: () => get('/qojim_sessions.php'),
  add: (session_id: number) => post('/qojim_sessions.php', { action: 'add_to_library', session_id }),
  remove: (session_id: number) => del('/qojim_sessions.php', { session_id }),
};

export const shareApi = {
  share: (session_id: number, friend_ids: number[]) =>
    post('/share_sessions.php', { action: 'share', session_id, friend_ids }),
  pending: () => get('/share_sessions.php?pending=1'),
  pendingCount: () => get('/share_sessions.php?count=1'),
  accept: (share_id: number) => post('/share_sessions.php', { action: 'accept', share_id }),
  decline: (share_id: number) => post('/share_sessions.php', { action: 'decline', share_id }),
};

// ── Entraînements ───────────────────────────────────────────────────────
export const workoutApi = {
  start: (session_id: number | string) => post('/workouts.php', { action: 'start', session_id }),
  complete: (workout_id: number, p: { notes: string; participants: number[]; exerciseOrder: any[]; nonCustomSets: any[] }) =>
    post('/workouts.php', {
      action: 'complete',
      workout_id,
      notes: p.notes,
      participants: p.participants,
      exercise_order: p.exerciseOrder,
      non_custom_sets: p.nonCustomSets,
      update_template: false,
    }),
  applyTemplateChanges: (workout_id: number, exercise_order: any[], save_in_gallery = false) =>
    post('/workouts.php', { action: 'apply_template_changes', workout_id, exercise_order, save_in_gallery }),
  cloneFromWorkout: (workout_id: number, archived = true) =>
    post('/workouts.php', { action: 'clone_from_workout', workout_id, archived }),
  updateNotes: (workout_id: number, notes: string) => post('/workouts.php', { action: 'update_notes', workout_id, notes }),
  remove: (id: number) => del('/workouts.php', { id }),
  history: (limit = 10, offset = 0) => get(`/workouts.php?history=1&limit=${limit}&offset=${offset}`),
  stats: () => get('/workouts.php?stats=1'),
};

// ── Feed ────────────────────────────────────────────────────────────────
export const feedApi = {
  feed: (limit = 10, offset = 0) => get(`/feed.php?feed=1&limit=${limit}&offset=${offset}`),
  detail: (workoutId: number) => get(`/feed.php?workout_id=${workoutId}`),
  toggleLike: (workout_id: number) => post('/feed.php', { action: 'like', workout_id }),
  comment: (workout_id: number, comment: string, parent_comment_id?: number | null) =>
    post('/feed.php', { action: 'comment', workout_id, comment, ...(parent_comment_id ? { parent_comment_id } : {}) }),
  deleteComment: (id: number) => del(`/feed.php?comment_id=${id}`),
};

export const friendsApi = {
  search: (term: string) => get(`/friends.php?search=${q(term)}`),
  list: () => get('/friends.php?list=1'),
  received: () => get('/friends.php?pending_received=1'),
  sent: () => get('/friends.php?pending_sent=1'),
  send: (friend_id: number) => post('/friends.php', { action: 'send_request', friend_id }),
  accept: (friendship_id: number) => post('/friends.php', { action: 'accept', friendship_id }),
  decline: (friendship_id: number) => post('/friends.php', { action: 'decline', friendship_id }),
  remove: (friendship_id: number) => del(`/friends.php?friendship_id=${friendship_id}`),
};

export const userApi = {
  profile: (userId: number | string) => get(`/user_profile.php?user_id=${userId}`),
  moreHistory: (userId: number | string, limit: number, offset: number) =>
    get(`/user_profile.php?user_id=${userId}&history=1&limit=${limit}&offset=${offset}`),
};

export const exerciseApi = {
  library: (userId: number | string) => get(`/exercises.php?library=1&user_id=${userId}`),
  progress: (userId: number | string, name: string, from?: string | null, to?: string | null) =>
    get(
      `/exercises.php?progress=1&user_id=${userId}&name=${q(name)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
};

export const reportApi = {
  pending: () => get('/monthly_reports.php?action=pending'),
  list: () => get('/monthly_reports.php?action=list'),
  detail: (year: number | string, month: number | string) =>
    get(`/monthly_reports.php?action=detail&year=${year}&month=${month}`),
};

export const prefsApi = {
  get: () => get('/preferences.php'),
  update: (p: Record<string, any>) => put('/preferences.php', p),
  uploadPdp: (uri: string, mime = 'image/jpeg') => {
    const fd = new FormData();
    const ext = mime.split('/')[1] || 'jpg';
    fd.append('pdp', { uri, name: `pdp.${ext === 'jpeg' ? 'jpg' : ext}`, type: mime } as any);
    return post('/preferences.php', fd);
  },
};

export const nutritionApi = {
  library: () => get('/nutrition.php?action=library'),
  createItem: (item: any) => post('/nutrition.php?action=library', item),
  updateItem: (id: number, item: any) => put(`/nutrition.php?action=library&id=${id}`, item),
  deleteItem: (id: number) => del(`/nutrition.php?action=library&id=${id}`),
  entries: (date: string) => get(`/nutrition.php?action=entries&date=${q(date)}`),
  createEntry: (e: any) => post('/nutrition.php?action=entries', e),
  updateEntryQty: (id: number, qty: number, mode: 'grams' | 'units') =>
    put(`/nutrition.php?action=entries&id=${id}`, mode === 'units' ? { quantity_units: qty } : { quantity_g: qty }),
  deleteEntry: (id: number) => del(`/nutrition.php?action=entries&id=${id}`),
  createMeal: (date: string) => post('/nutrition.php?action=meals', { date }),
  moveEntry: (id: number, meal_id: number | null) => put(`/nutrition.php?action=entries&id=${id}`, { meal_id }),
  deleteMeal: (id: number) => del(`/nutrition.php?action=meals&id=${id}`),
};
