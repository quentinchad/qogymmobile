/**
 * Feature flags — interrupteurs centraux pour activer/désactiver des
 * fonctionnalités sans toucher au reste du code.
 *
 * Pourquoi : le code des pas (carte Feed + section Profil + API + capteur)
 * est entièrement livré et fonctionnel, mais on veut le masquer
 * temporairement (déploiement APK/back pas encore fait, ou simple choix
 * de ne pas l'exposer tout de suite).
 *
 * Pour RÉACTIVER l'affichage des pas plus tard : repasser STEPS_FEATURE à
 * `true` ci-dessous, rebuild front (npm run build) + FTP. Rien d'autre à
 * faire — aucune logique n'a été supprimée.
 */

// ⬇️ Mettre à true pour réafficher le compteur de pas (Feed + Profil).
export const STEPS_FEATURE = false;

export default { STEPS_FEATURE };
