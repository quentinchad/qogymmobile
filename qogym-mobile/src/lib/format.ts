const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const MONTH_NAMES = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Les dates MySQL "YYYY-MM-DD HH:MM:SS" sont en heure serveur (Paris) ; on les lit en local. */
export const parseDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
};

export const fmtDateTime = (s?: string | null) => {
  const d = parseDate(s);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDate = (s?: string | null) => {
  const d = parseDate(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};
export const fmtDateShort = (s?: string | null) => {
  const d = parseDate(s);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : '';
};
export const fmtDayMonth = (s?: string | null) => {
  const d = parseDate(s);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : '';
};

export const fmtRelative = (s?: string | null) => {
  const d = parseDate(s);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `Il y a ${days} j`;
  return fmtDateShort(s);
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const shiftISO = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toISO(dt);
};
export const fmtDayLabel = (iso: string) => {
  const t = todayISO();
  if (iso === t) return "Aujourd'hui";
  if (iso === shiftISO(t, -1)) return 'Hier';
  if (iso === shiftISO(t, 1)) return 'Demain';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]}`;
};

/** Chrono : m:ss ou h:mm:ss */
export const fmtClock = (totalSec: number) => {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

export const fmtRest = (s?: number | null) => {
  if (!s) return 'Pas de repos';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}min` : `${m}m${pad(r)}`;
};

export const fmtDuration = (sec?: number | null) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h${pad(m)}`;
};

export const pluralize = (label: string, n: number) => {
  if (!label) return '';
  if (n <= 1 || /[sx]$/i.test(label)) return label;
  return label + 's';
};

export const num = (v: any) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/** Nom automatique d'une séance libre selon l'heure (même règle que le site). */
export const autoSessionName = (variant: 'start' | 'end') => {
  const h = new Date().getHours();
  if (variant === 'start') {
    const m = h < 5 ? 'de la nuit' : h < 12 ? 'du matin' : h < 14 ? 'du midi' : h < 18 ? 'de l’après-midi' : h < 22 ? 'du soir' : 'de la nuit';
    return `Entraînement ${m}`;
  }
  const m = h < 5 ? 'de nuit' : h < 12 ? 'du matin' : h < 14 ? 'du midi' : h < 18 ? 'd’après-midi' : h < 22 ? 'du soir' : 'de nuit';
  return `Entraînement ${m}`;
};

export const isTrue = (v: any) => v === true || v === 1 || v === '1';
