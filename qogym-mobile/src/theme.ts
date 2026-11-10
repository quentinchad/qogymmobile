/**
 * Palette inspirée du logo (bleu nuit, or, violet). Toutes les couleurs de
 * l'app passent par ici : changer le thème = modifier ce fichier.
 */
export const colors = {
  bg: '#0b1322',
  surface: '#131d31',
  surface2: '#1a2740',
  surface3: '#22314e',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.14)',

  text: '#eef1f7',
  textDim: '#9aa6bd',
  textFaint: '#66738c',

  gold: '#d4a64a',
  goldLight: '#f0c96b',
  goldSoft: 'rgba(212,166,74,0.16)',
  purple: '#8b5cf6',
  purpleSoft: 'rgba(139,92,246,0.16)',

  success: '#34c77b',
  successSoft: 'rgba(52,199,123,0.16)',
  danger: '#ef5350',
  dangerSoft: 'rgba(239,83,80,0.14)',
  warning: '#f5a524',

  protein: '#5aa9ff',
  carbs: '#f5a524',
  fat: '#e86bb4',

  overlay: 'rgba(3,7,15,0.72)',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const font = {
  h1: { fontSize: 26, fontWeight: '800' as const, color: colors.text, letterSpacing: -0.4 },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 16, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textDim },
  tiny: { fontSize: 11, color: colors.textFaint },
};

export const QOJIM = 'https://qojim.com';
export const API_URL = `${QOJIM}/qogym-api`;
export const avatarUrl = (pdp?: string | null) => (pdp ? `${QOJIM}/pdp/${pdp}` : null);
export const sessionImageUrl = (img?: string | null) =>
  !img ? null : img.startsWith('http') ? img : `${QOJIM}/imgseances/${img}`;
