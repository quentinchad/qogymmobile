import React, { useState } from 'react';
import { useDailySteps } from '../hooks/useDailySteps';
import { STEPS_FEATURE } from '../utils/featureFlags';
import './StepsCard.css';

const HIDE_KEY = 'qogym_steps_card_hidden';

const isHidden = () => {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (_) { return false; }
};
const setHidden = (v) => {
  try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch (_) {}
};

/**
 * StepsCard — carte compacte des pas du jour, affichée en haut du Feed.
 *
 * - Anneau de progression vers l'objectif (si défini).
 * - Bouton ✕ pour masquer (choix persistant en localStorage). Quand masquée,
 *   on affiche un petit lien discret "Afficher les pas" pour pouvoir revenir.
 * - Si aucun pont natif ne fournit les pas, on propose une saisie manuelle
 *   (toujours utile : la fonctionnalité reste opérationnelle sans le natif).
 * - Si aucun objectif n'est défini, on invite à le définir depuis le Profil.
 */
const StepsCard = () => {
  // Fonctionnalité pas désactivée pour le moment (cf. utils/featureFlags).
  // Early-return AVANT tout hook : STEPS_FEATURE est une constante module,
  // l'ordre des hooks reste donc stable entre les rendus.
  if (!STEPS_FEATURE) return null;

  return <StepsCardInner />;
};

const StepsCardInner = () => {
  const { steps, goal, source, bridgePresent, loading, migrationNeeded, setManualSteps } = useDailySteps();
  const [hidden, setHiddenState] = useState(isHidden);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hide = () => { setHidden(true); setHiddenState(true); };
  const show = () => { setHidden(false); setHiddenState(false); };

  // Migration BDD pas encore exécutée → on n'affiche rien du tout (pas de
  // carte "0 pas" trompeuse). La feature apparaîtra dès la migration faite.
  if (migrationNeeded) return null;

  if (hidden) {
    return (
      <button type="button" className="steps-card-show" onClick={show}>
        👟 Afficher les pas
      </button>
    );
  }

  const value = steps == null ? 0 : steps;
  const hasGoal = goal != null && goal > 0;
  // 'native' (total fiable) ou 'native-partial' (capteur app ouverte) =
  // synchro automatique côté capteur.
  const isAuto = typeof source === 'string' && source.indexOf('native') === 0;
  const pct = hasGoal ? Math.min(100, (value / goal) * 100) : 0;
  // Anneau : circonférence d'un cercle r=15.9 ≈ 100 → on pilote dashoffset.
  const dashoffset = 100 - pct;

  const startEdit = () => {
    setDraft(value ? String(value) : '');
    setEditing(true);
  };
  const commitEdit = async () => {
    await setManualSteps(draft);
    setEditing(false);
  };

  return (
    <div className="steps-card card">
      <button
        type="button"
        className="steps-card-close"
        onClick={hide}
        aria-label="Masquer les pas"
        title="Masquer (réaffichable plus bas)"
      >
        ✕
      </button>

      <div className="steps-card-ring-wrap">
        <svg className="steps-card-ring" viewBox="-4 -4 44 44" aria-hidden="true">
          <defs>
            <filter id="stepsRingGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="0.9" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle className="steps-ring-track" cx="18" cy="18" r="15.9" />
          {hasGoal && (
            <circle
              className="steps-ring-fill"
              cx="18" cy="18" r="15.9"
              filter="url(#stepsRingGlow)"
              style={{ strokeDashoffset: dashoffset }}
            />
          )}
        </svg>
        <div className="steps-card-ring-center">
          <span className="steps-card-icon">👟</span>
        </div>
      </div>

      <div className="steps-card-body">
        <div className="steps-card-count">
          {loading && steps == null
            ? '—'
            : value.toLocaleString('fr-FR')}
          <span className="steps-card-unit"> pas</span>
        </div>
        {hasGoal ? (
          <div className="steps-card-sub">
            Objectif {goal.toLocaleString('fr-FR')} ·{' '}
            {value >= goal
              ? '🎉 Atteint !'
              : `${(goal - value).toLocaleString('fr-FR')} restants`}
          </div>
        ) : (
          <div className="steps-card-sub steps-card-sub--muted">
            Définis un objectif depuis ton profil
          </div>
        )}

        {/* Saisie manuelle : proposée si pas de pont natif détecté, ou si
            l'utilisateur veut corriger la valeur. */}
        {editing ? (
          <div className="steps-card-edit">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              className="steps-card-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nombre de pas"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }}
            />
            <button type="button" className="steps-card-btn" onClick={commitEdit}>OK</button>
            <button
              type="button"
              className="steps-card-btn steps-card-btn--ghost"
              onClick={() => setEditing(false)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <button type="button" className="steps-card-edit-trigger" onClick={startEdit}>
            {isAuto
              ? 'Synchronisé · corriger'
              : (bridgePresent ? 'Mettre à jour' : 'Saisir mes pas')}
          </button>
        )}
      </div>
    </div>
  );
};

export default StepsCard;
