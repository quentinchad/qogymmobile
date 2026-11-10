import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionService, workoutService } from '../services/api';
import { useToast } from './Toast';
import './WorkoutLaunchActions.css';

/**
 * Actions "relancer / enregistrer" sur un entraînement terminé, partagées
 * entre le Feed et les Profils (WorkoutDetailModal).
 *
 * `workout` = détail d'un entraînement terminé (feedService.getWorkoutDetail) :
 *   { id, user_id, workout_session_id, ... }
 *
 * ── Lancer ────────────────────────────────────────────────────────────
 *  1. Si la séance d'origine existe toujours, est utilisable par
 *     l'utilisateur (la sienne ou dans sa bibliothèque) ET contient des
 *     exercices → on la lance directement (on garde l'historique par séance).
 *  2. Sinon (séance d'un ami, séance supprimée depuis, séance libre jamais
 *     enregistrée, template vide...) → le backend recrée une séance à partir
 *     de ce qui a été fait dans l'entraînement, créée ARCHIVÉE (invisible
 *     dans la galerie). À la fin, l'app propose de l'enregistrer.
 *
 * ── Enregistrer dans la bibliothèque ──────────────────────────────────
 *  Désarchive la séance si elle est à l'utilisateur, sinon crée une copie
 *  visible dans sa galerie.
 */
export const useWorkoutLaunch = ({ workout, onNavigate }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [launching, setLaunching] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  // Nouvelle séance affichée → on repart de zéro
  useEffect(() => { setSaved(false); }, [workout?.id]);

  // null si la séance n'existe plus (404 : soft delete) ou est inaccessible
  const fetchSession = async (sessionId) => {
    if (!sessionId) return null;
    try {
      const res = await sessionService.getById(sessionId);
      return res.data.session || null;
    } catch (_) {
      return null;
    }
  };

  const isUsableAsIs = (session) =>
    !!session &&
    (Number(session.is_owner) === 1 || Number(session.in_library) === 1) &&
    (session.exercises || []).length > 0;

  const launch = async () => {
    if (!workout || launching) return;
    setLaunching(true);
    try {
      const session = await fetchSession(workout.workout_session_id);

      if (isUsableAsIs(session)) {
        if (onNavigate) onNavigate();
        navigate(`/workout/${session.id}`);
        return;
      }

      const res = await workoutService.cloneFromWorkout(workout.id, { archived: true });
      const newId = res.data.session_id;
      if (!newId) throw new Error('no id');
      if (onNavigate) onNavigate();
      navigate(`/workout/${newId}`, {
        state: { isEmptyWorkout: !res.data.exercises_count },
      });
    } catch (err) {
      showToast(err.response?.data?.error || 'Impossible de lancer cette séance', 'error');
    } finally {
      setLaunching(false);
    }
  };

  const saveToLibrary = async () => {
    if (!workout || saving || saved) return;
    setSaving(true);
    try {
      const session = await fetchSession(workout.workout_session_id);

      // Déjà dans la bibliothèque (séance Qojim ajoutée)
      if (session && Number(session.in_library) === 1) {
        setSaved(true);
        showToast('Cette séance est déjà dans ta bibliothèque', 'info');
        return;
      }

      // Séance à moi, avec ses exercices : on la désarchive si besoin
      if (session && Number(session.is_owner) === 1 && (session.exercises || []).length > 0) {
        if (Number(session.is_archived) === 1) {
          await sessionService.patch(session.id, { is_archived: 0 });
          showToast('Séance ajoutée à ta bibliothèque', 'success');
        } else {
          showToast('Cette séance est déjà dans ta bibliothèque', 'info');
        }
        setSaved(true);
        return;
      }

      // Séance d'un ami, supprimée, ou jamais enregistrée → nouvelle copie
      await workoutService.cloneFromWorkout(workout.id, { archived: false });
      setSaved(true);
      showToast('Séance ajoutée à ta bibliothèque', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || "Impossible d'enregistrer la séance", 'error');
    } finally {
      setSaving(false);
    }
  };

  return { launch, launching, saveToLibrary, saving, saved };
};

/** Gros bouton "Lancer cette séance" */
export const LaunchWorkoutButton = ({ onClick, loading }) => (
  <button
    type="button"
    className="btn btn-primary wla-launch"
    onClick={onClick}
    disabled={loading}
  >
    {loading ? 'Préparation…' : '▶ Lancer cette séance'}
  </button>
);

/** Bouton "⋯" + petit menu (enregistrer dans la bibliothèque) */
export const WorkoutMenu = ({ onSave, saving, saved }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  return (
    <div className="wla-menu" ref={ref}>
      <button
        type="button"
        className="wla-menu-btn"
        aria-label="Plus d'actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="wla-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="wla-menu-item"
            disabled={saving || saved}
            onClick={() => { setOpen(false); onSave(); }}
          >
            {saved ? '✓ Dans ma bibliothèque' : saving ? 'Enregistrement…' : 'Enregistrer dans ma bibliothèque'}
          </button>
        </div>
      )}
    </div>
  );
};