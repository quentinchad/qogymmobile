import React, { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useActiveWorkout } from '../contexts/ActiveWorkoutContext';
import './MiniWorkout.css';

/**
 * Mini-card flottante affichée en bas (juste au-dessus de la BottomNav)
 * quand un workout est actif ET qu'on n'est pas sur la page Workout.
 *
 * Tap ou swipe vers le haut → ouvre la page Workout.
 * Pas de bouton fermer : la fermeture se fait via Terminer/Abandonner
 * depuis la page Workout.
 */

const formatTime = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const MiniWorkout = () => {
  const { state, timerSeconds, hasActive } = useActiveWorkout();
  const navigate = useNavigate();
  const location = useLocation();
  const [pressing, setPressing] = useState(false);

  // Touch tracking pour le swipe vers le haut
  const touchStart = useRef(null);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    setPressing(true);
  };

  const onTouchEnd = (e) => {
    setPressing(false);
    const start = touchStart.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dx = t.clientX - start.x;
    const elapsed = Date.now() - start.time;

    // Swipe vers le haut : déplacement > 30px en moins de 500ms, axe vertical
    const isSwipeUp = dy < -30 && Math.abs(dy) > Math.abs(dx) && elapsed < 500;
    // Tap simple : déplacement < 10px en x et y
    const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10 && elapsed < 400;

    if (isSwipeUp || isTap) {
      open();
    }
    touchStart.current = null;
  };

  const open = () => {
    if (state.sessionId) navigate(`/workout/${state.sessionId}`);
  };

  // Cache si pas de workout actif ou si on est déjà sur la page workout
  if (!hasActive) return null;
  if (location.pathname.startsWith('/workout/')) return null;

  const exoCount = (state.exercises || []).length;
  const completedCount = Object.keys(state.validatedSets || {}).length;
  // Total prévu : somme des séries (en tenant compte des extraSets)
  const totalSets = (state.exercises || []).reduce((acc, e) => {
    const extra = state.extraSets?.[e.id];
    const n = extra !== undefined ? extra : (parseInt(e.sets) || 1);
    return acc + n;
  }, 0);

  return (
    <div
      className={`mini-workout${pressing ? ' mini-workout--pressing' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { setPressing(false); touchStart.current = null; }}
      onClick={open}
      role="button"
      aria-label="Reprendre l'entraînement en cours"
      data-no-swipe
    >
      <div className="mini-workout-grip" aria-hidden="true">
        <span className="mini-workout-handle" />
      </div>
      <div className="mini-workout-body">
        <div className="mini-workout-name">
          {state.sessionName || 'Entraînement'}
        </div>
        <div className="mini-workout-meta">
          <span className="mini-workout-timer">
            {state.timerActive
              ? <span className="mini-workout-pulse" />
              : <span className="mini-workout-paused">▸</span>}
            {formatTime(timerSeconds)}
          </span>
          {exoCount > 0 && (
            <span className="mini-workout-stats">
              {completedCount} / {totalSets} séries
            </span>
          )}
        </div>
      </div>
      <div className="mini-workout-arrow" aria-hidden="true">↑</div>
    </div>
  );
};

export default MiniWorkout;