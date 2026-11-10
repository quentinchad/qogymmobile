import axios from 'axios';

// Configuration de l'URL de l'API
// En production, changez cette URL vers votre serveur
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://qojim.com/qogym-api';

// Instance axios configurée
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur pour ajouter le token à chaque requête
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('qogym_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Si le body est un FormData, laisser le navigateur définir le Content-Type
    // (avec boundary) automatiquement — ne pas forcer application/json
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Intercepteur pour gérer les erreurs d'authentification
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      console.error('❌ Erreur 401:', error.response.data);
      // Ne pas rediriger automatiquement, laisser App.js gérer ça
      // On supprime juste les tokens invalides
      localStorage.removeItem('qogym_token');
      localStorage.removeItem('qogym_user');
    }
    return Promise.reject(error);
  }
);

// Services d'authentification
export const authService = {
  register: (email, username, password) => 
    api.post('/auth.php', { action: 'register', email, username, password }),
  
  login: (email, password) => 
    api.post('/auth.php', { action: 'login', email, password }),
  
  logout: () => 
    api.post('/auth.php', { action: 'logout' }),
  
  verifyToken: () => 
    api.get('/auth.php'),

  changePassword: (currentPassword, newPassword) => 
    api.post('/auth.php', {
      action: 'change_password',
      current_password: currentPassword,
      new_password: newPassword
    }),

  changeUsername: (newUsername) =>
    api.post('/auth.php', {
      action: 'change_username',
      username: newUsername,
    }),

  verifyEmail: (token) =>
    api.post('/auth.php', { action: 'verify_email', token }),

  resendVerification: (email) =>
    api.post('/auth.php', { action: 'resend_verification', email }),

  requestPasswordReset: (email) => api.post('/password_reset', {
    action: 'request_reset',
    email: email
  }),
  
  validateResetToken: (token) => api.get(`/password_reset?token=${token}`),
  
  resetPassword: (token, newPassword) => api.post('/password_reset', {
    action: 'reset_password',
    token: token,
    new_password: newPassword
  })
};

// Services des séances
export const sessionService = {
  getAll: () => 
    api.get('/sessions.php'),
  
  getById: (id) => 
    api.get(`/sessions.php?id=${id}`),
  
  getSessionTypes: () => 
    api.get('/sessions.php?types=1'),

  // Retourne tous les exos accessibles à l'utilisateur (ses séances +
  // bibliothèque), dédoublonnés par nom. Utilisé par le picker pendant
  // un workout.
  getAllExercises: () =>
    api.get('/sessions.php?all_exercises=1'),

  // Recherche dans la base d'exercices externe (wger.de), via le proxy
  // backend. Utilisé pour suggérer des exercices lors de la création
  // d'une séance, sans dépendre de la bibliothèque perso de l'utilisateur.
  searchExternalExercises: (term) =>
    api.get(`/sessions.php?external_exercise_search=1&term=${encodeURIComponent(term)}`),
  
  /**
   * Création d'une séance.
   * sessionData doit être un FormData (pour supporter l'upload d'image).
   */
  create: (sessionData) =>
    api.post('/sessions.php', sessionData),

  /**
   * Mise à jour d'une séance.
   * sessionData doit être un FormData avec _method=PUT (pour supporter l'upload d'image).
   * PHP ne lit pas les fichiers sur une requête PUT native, on passe donc par POST + _method.
   */
  update: (sessionData) => {
    // S'assurer que le spoofing de méthode est présent
    if (sessionData instanceof FormData && !sessionData.has('_method')) {
      sessionData.append('_method', 'PUT');
    }
    return api.post('/sessions.php', sessionData);
  },

  // Pour les modifications légères (archivage, renommage simple) sans
  // upload de fichier, on utilise un PUT JSON classique.
  patch: (id, fields) =>
    api.put('/sessions.php', { id, ...fields }),
  
  delete: (id) => 
    api.delete('/sessions.php', { data: { id } }),
};

// Services des rapports mensuels
export const monthlyReportService = {
  // Admin : déclencher la génération des rapports M-1 pour tous les users
  generate: () =>
    api.post('/monthly_reports.php', { action: 'generate' }),

  // User : y a-t-il un rapport non encore consulté ?
  getPending: () =>
    api.get('/monthly_reports.php?action=pending'),

  // User : liste de tous mes rapports
  getList: () =>
    api.get('/monthly_reports.php?action=list'),

  // User : détail (stats calculées + comparatif M-1 vs M-2)
  getDetail: (year, month) =>
    api.get(`/monthly_reports.php?action=detail&year=${year}&month=${month}`),
};

// Services des séances Qojim
export const qojimService = {
  getAll: () => 
    api.get('/qojim_sessions.php'),
  
  addToLibrary: (sessionId) => 
    api.post('/qojim_sessions.php', { action: 'add_to_library', session_id: sessionId }),
  
  removeFromLibrary: (sessionId) => 
    api.delete('/qojim_sessions.php', { data: { session_id: sessionId } }),
};

// Services des entraînements
export const workoutService = {
  start: (sessionId) => 
    api.post('/workouts.php', { action: 'start', session_id: sessionId }),
  
  recordSet: (workoutId, exerciseId, setNumber, weight, reps) => 
    api.post('/workouts.php', { 
      action: 'record_set', 
      workout_id: workoutId, 
      exercise_id: exerciseId, 
      set_number: setNumber, 
      weight, 
      reps 
    }),
  
  // Appel "engagement final" : sauve perfs + sets en une seule transaction.
  // Le frontend appelle ça AVANT la question "mettre à jour la séance ?",
  // pour que fermer l'app à n'importe quel moment après le clic "Terminer"
  // confirmé garantisse la sauvegarde de l'entraînement.
  complete: (workoutId, payload = {}) => {
    const {
      notes = '',
      participants = [],
      exerciseOrder = [],
      nonCustomSets = [],
    } = payload;
    return api.post('/workouts.php', {
      action: 'complete',
      workout_id: workoutId,
      notes,
      participants,
      exercise_order: exerciseOrder,
      non_custom_sets: nonCustomSets,
      update_template: false, // toujours false ici : propagation = appel séparé
    });
  },

  // Second appel optionnel : applique les modifs (ordre, supersets, exos
  // custom) à la séance template. Idempotent côté backend.
  applyTemplateChanges: (workoutId, exerciseOrder = [], saveInGallery = false) =>
    api.post('/workouts.php', {
      action: 'apply_template_changes',
      workout_id: workoutId,
      exercise_order: exerciseOrder,
      save_in_gallery: saveInGallery,
    }),

  // Recrée une séance (pour l'utilisateur connecté) à partir d'un entraînement
  // terminé — le sien ou celui d'un ami. archived=true : copie cachée de la
  // galerie (lancement direct) ; archived=false : ajout à la bibliothèque.
  cloneFromWorkout: (workoutId, { archived = true } = {}) =>
    api.post('/workouts.php', {
      action: 'clone_from_workout',
      workout_id: workoutId,
      archived,
    }),

  updateNotes: (workoutId, notes) =>
    api.post('/workouts.php', { action: 'update_notes', workout_id: workoutId, notes }),
  
  delete: (workoutId) => 
    api.delete('/workouts.php', { data: { id: workoutId } }),
  
  getHistory: (limit = 50, offset = 0) => 
    api.get(`/workouts.php?history=1&limit=${limit}&offset=${offset}`),
  
  getById: (id) => 
    api.get(`/workouts.php?id=${id}`),
  
  getStats: (exerciseId = null) => 
    exerciseId 
      ? api.get(`/workouts.php?stats=1&exercise_id=${exerciseId}`)
      : api.get('/workouts.php?stats=1'),
};

// Services du feed
export const feedService = {
  getFeed: (limit = 50, offset = 0) => 
    api.get(`/feed.php?feed=1&limit=${limit}&offset=${offset}`),
  
  getWorkoutDetail: (workoutId) => 
    api.get(`/feed.php?workout_id=${workoutId}`),
  
  likeWorkout: (workoutId) => 
    api.post('/feed.php', { action: 'like', workout_id: workoutId }),
  
  unlikeWorkout: (workoutId) => 
    api.post('/feed.php', { action: 'like', workout_id: workoutId }),
  
  // parentCommentId optionnel : si fourni, c'est une réponse au commentaire
  // de cet ID. Sinon (null/undefined), c'est un commentaire racine.
  addComment: (workoutId, comment, parentCommentId = null) =>
    api.post('/feed.php', {
      action: 'comment',
      workout_id: workoutId,
      comment,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    }),
  
  deleteComment: (commentId) => 
    api.delete(`/feed.php?comment_id=${commentId}`),
};

// Services des amis
export const friendsService = {
  searchUsers: (searchTerm) => 
    api.get(`/friends.php?search=${encodeURIComponent(searchTerm)}`),
  
  getFriends: () => 
    api.get('/friends.php?list=1'),
  
  getPendingReceived: () => 
    api.get('/friends.php?pending_received=1'),
  
  getPendingSent: () => 
    api.get('/friends.php?pending_sent=1'),
  
  sendRequest: (friendId) => 
    api.post('/friends.php', { action: 'send_request', friend_id: friendId }),
  
  acceptRequest: (friendshipId) => 
    api.post('/friends.php', { action: 'accept', friendship_id: friendshipId }),
  
  declineRequest: (friendshipId) => 
    api.post('/friends.php', { action: 'decline', friendship_id: friendshipId }),
  
  removeFriend: (friendshipId) => 
    api.delete(`/friends.php?friendship_id=${friendshipId}`),
};

// Services admin
export const adminService = {
  getStats: () => 
    api.get('/admin.php?stats=1'),
  
  getUsers: () => 
    api.get('/admin.php?users=1'),
  
  getSessionTypes: () => 
    api.get('/admin.php?session_types=1'),
  
  createSessionType: (name) => 
    api.post('/admin.php', { action: 'create_type', name }),
  
  updateSessionType: (typeId, name) => 
    api.put('/admin.php', { action: 'update_type', type_id: typeId, name }),
  
  deleteSessionType: (typeId) => 
    api.delete(`/admin.php?type_id=${typeId}`),
  
  getQojimSessions: () => 
    api.get('/admin.php?qojim_sessions=1'),
};

// Service profil utilisateur public
export const userProfileService = {
  getProfile: (userId) =>
    api.get(`/user_profile.php?user_id=${userId}`),

  // Charge des entraînements supplémentaires de l'historique paginé
  // (au-delà des 20 premiers retournés par getProfile)
  getMoreHistory: (userId, limit = 10, offset = 0) =>
    api.get(`/user_profile.php?user_id=${userId}&history=1&limit=${limit}&offset=${offset}`),
};

// Service bibliothèque d'exercices + progression (1RM, graphiques...)
export const exerciseLibraryService = {
  // Liste des exercices déjà réalisés par un utilisateur (soi-même par
  // défaut), avec stats (nb de fois fait, dernière fois, meilleur 1RM...).
  getLibrary: (userId) =>
    api.get(`/exercises.php?library=1&user_id=${userId}`),

  // Progression détaillée d'UN exercice (par nom) dans le temps.
  // from / to (optionnels) : bornes YYYY-MM-DD pour filtrer la période affichée.
  getProgress: (userId, name, from = null, to = null) => {
    const params = new URLSearchParams({ progress: '1', user_id: userId, name });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return api.get(`/exercises.php?${params.toString()}`);
  },
};

// Services de partage de séances
export const shareService = {
  // Partager une séance avec une liste d'amis
  shareSession: (sessionId, friendIds) =>
    api.post('/share_sessions.php', { action: 'share', session_id: sessionId, friend_ids: friendIds }),

  // Récupérer les partages reçus en attente
  getPending: () =>
    api.get('/share_sessions.php?pending=1'),

  // Nombre de partages en attente (pour le badge)
  getPendingCount: () =>
    api.get('/share_sessions.php?count=1'),

  // Accepter un partage (crée une copie de la séance)
  accept: (shareId) =>
    api.post('/share_sessions.php', { action: 'accept', share_id: shareId }),

  // Refuser un partage
  decline: (shareId) =>
    api.post('/share_sessions.php', { action: 'decline', share_id: shareId }),
};

// Services de préférences
export const preferencesService = {
  getPreferences: () => 
    api.get('/preferences.php'),
  
  updatePreferences: (preferences) => 
    api.put('/preferences.php', preferences),
  
  uploadProfilePicture: (file) => {
    const formData = new FormData();
    formData.append('pdp', file);
    return axios.post(API_BASE_URL + '/preferences.php', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': `Bearer ${localStorage.getItem('qogym_token')}`
      }
    });
  }
};

// Service relances email (admin)
export const remindersService = {
  getStats: () =>
    api.get('/send_reminders.php'),

  send: (type = 'all') =>
    api.post('/send_reminders.php', { type }),
};

// Nettoyage des comptes non confirmés expirés (admin)
export const unverifiedCleanupService = {
  getStats: () =>
    api.get('/cleanup_unverified_accounts.php'),

  run: () =>
    api.post('/cleanup_unverified_accounts.php'),
};

// Module Nutrition : bibliothèque d'aliments + journal de consommations
export const nutritionService = {
  // ── Bibliothèque ──
  getLibrary: () =>
    api.get('/nutrition.php?action=library'),

  createLibraryItem: (item) =>
    api.post('/nutrition.php?action=library', item),

  updateLibraryItem: (id, item) =>
    api.put(`/nutrition.php?action=library&id=${id}`, item),

  deleteLibraryItem: (id) =>
    api.delete(`/nutrition.php?action=library&id=${id}`),

  // ── Entrées du jour ──
  getEntries: (date /* YYYY-MM-DD */) =>
    api.get(`/nutrition.php?action=entries&date=${encodeURIComponent(date)}`),

  // entry: { food_item_id?, name, kcal_per_100g, ..., quantity_g, consumed_at? }
  createEntry: (entry) =>
    api.post('/nutrition.php?action=entries', entry),

  // mode peut valoir 'grams' (défaut) ou 'units' ; dans ce dernier cas la
  // valeur passée est interprétée comme un nombre d'unités (ex: 2 pommes)
  // que le backend convertit en grammes via le grams_per_unit de l'entrée.
  updateEntryQuantity: (id, quantity, mode = 'grams') =>
    api.put(
      `/nutrition.php?action=entries&id=${id}`,
      mode === 'units' ? { quantity_units: quantity } : { quantity_g: quantity }
    ),

  deleteEntry: (id) =>
    api.delete(`/nutrition.php?action=entries&id=${id}`),

  // ── Repas (regroupent des entrées d'un jour : "Repas 1", "Repas 2"...) ──
  createMeal: (date /* YYYY-MM-DD */) =>
    api.post('/nutrition.php?action=meals', { date }),

  // Déplace une entrée dans un repas (mealId) ou la sort de son repas (null)
  moveEntryToMeal: (id, mealId) =>
    api.put(`/nutrition.php?action=entries&id=${id}`, { meal_id: mealId }),

  // Supprime le repas ET les aliments qu'il contient
  deleteMeal: (id) =>
    api.delete(`/nutrition.php?action=meals&id=${id}`),
};

// Module Pas quotidiens : objectif + historique. Les pas peuvent venir d'un
// pont natif (capteur du téléphone) injecté dans la WebView, ou d'une saisie
// manuelle de secours. Voir utils/steps.js pour la logique de lecture.
export const stepsService = {
  // date locale du client au format YYYY-MM-DD (le serveur ne connaît pas
  // le fuseau de l'utilisateur)
  getToday: (day) =>
    api.get(`/steps.php?action=today${day ? `&day=${encodeURIComponent(day)}` : ''}`),

  getRange: (from, to) =>
    api.get(`/steps.php?action=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  // upsert des pas d'un jour. source: 'native' | 'manual'
  pushSteps: ({ steps, day, source = 'manual' }) =>
    api.post('/steps.php', { steps, day, source }),

  // null pour retirer l'objectif
  setGoal: (goal) =>
    api.put('/steps.php', { goal }),
};

export default api;