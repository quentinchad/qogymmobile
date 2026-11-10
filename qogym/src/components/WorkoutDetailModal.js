import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { feedService, workoutService } from '../services/api';
import { useToast } from './Toast';
import { groupBySupersets, supersetLetter } from '../utils/supersets';
import { bestOneRepMax } from '../utils/oneRepMax';
import OneRepMaxBadge from './OneRepMaxBadge';
import { useWorkoutLaunch, LaunchWorkoutButton, WorkoutMenu } from './WorkoutLaunchActions';
import './WorkoutDetailModal.css';

/**
 * Modale de détail d'un entraînement terminé — partagée entre le Feed et
 * le Profil (historique). Charge le détail à l'ouverture via l'API du Feed
 * (qui retourne déjà la liste des exos avec leurs séries).
 *
 * Props :
 *   - workoutId : id de l'entraînement à afficher (ouvre la modale si non null)
 *   - onClose   : () => void
 *   - currentUserId : id du user connecté (pour autoriser l'édition de la
 *                    description)
 */
const WorkoutDetailModal = ({ workoutId, onClose, currentUserId }) => {
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // Édition de la description (notes) — uniquement pour ses propres workouts.
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft]     = useState('');
  const [notesSaving, setNotesSaving]   = useState(false);
  const { showToast } = useToast();

  // Lancer la séance affichée / l'enregistrer dans la bibliothèque
  const { launch, launching, saveToLibrary, saving, saved } = useWorkoutLaunch({
    workout: data,
    onNavigate: onClose,
  });

  useEffect(() => {
    if (!workoutId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    feedService.getWorkoutDetail(workoutId)
      .then(res => {
        if (cancelled) return;
        const w = res.data?.workout || res.data;
        setData(w);
        setNotesDraft(w?.notes || '');
      })
      .catch(err => {
        if (!cancelled) setError(err.response?.data?.error || 'Erreur de chargement');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workoutId]);

  // Bloque le scroll de la page derrière + ferme à Échap.
  useEffect(() => {
    if (!workoutId) return;
    document.body.classList.add('modal-open');
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [workoutId, onClose]);

  if (!workoutId) return null;

  const isOwn = !!(data && currentUserId && data.user_id === currentUserId);

  const handleSaveNotes = async () => {
    if (!data) return;
    const trimmed = notesDraft.trim();
    setNotesSaving(true);
    try {
      await workoutService.updateNotes(data.id, trimmed);
      setData(prev => prev ? { ...prev, notes: trimmed } : prev);
      setEditingNotes(false);
      showToast('Description mise à jour', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de la mise à jour', 'error');
    } finally {
      setNotesSaving(false);
    }
  };

  // Ouvre la page de progression d'un exercice pour l'auteur de la séance.
  const openExercise = (name) => {
    if (!data || !name) return;
    const uid = data.user_id;
    onClose();
    navigate(`/exercises/${uid}/${encodeURIComponent(name)}`);
  };

  const renderExName = (ex) => {
    const name = ex.exercise_name || ex.name;
    return (
      <span
        className="exercise-name-link"
        role="link"
        tabIndex={0}
        onClick={() => openExercise(name)}
        onKeyDown={(e) => { if (e.key === 'Enter') openExercise(name); }}
      >
        {name}
      </span>
    );
  };

  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}min`;
    return `${m}m${String(s).padStart(2, '0')}`;
  };

  return ReactDOM.createPortal(
    <div className="wdm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wdm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wdm-header">
          <h2 className="wdm-title">
            {loading ? 'Chargement…' : (data?.session_name || 'Entraînement')}
          </h2>
          <div className="wla-header-actions">
            {data && !loading && (
              <WorkoutMenu onSave={saveToLibrary} saving={saving} saved={saved} />
            )}
            <button type="button" className="wdm-close" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </div>

        <div className="wdm-body">
          {loading && (
            <div className="wdm-loading">
              <div className="spinner" />
            </div>
          )}

          {error && !loading && (
            <div className="form-error">{error}</div>
          )}

          {data && !loading && (
            <>
              {/* Métadonnées */}
              <div className="wdm-meta">
                <div className="wdm-meta-item">
                  <span className="wdm-meta-label">Date</span>
                  <span className="wdm-meta-value">
                    {new Date(data.completed_at).toLocaleDateString('fr-FR', {
                      day: 'numeric', month: 'long', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                {data.session_type_name && (
                  <div className="wdm-meta-item">
                    <span className="wdm-meta-label">Type</span>
                    <span className="wdm-meta-value">{data.session_type_name}</span>
                  </div>
                )}
                {data.duration_seconds > 0 && (
                  <div className="wdm-meta-item">
                    <span className="wdm-meta-label">Durée</span>
                    <span className="wdm-meta-value">{formatDuration(data.duration_seconds)}</span>
                  </div>
                )}
              </div>

              <LaunchWorkoutButton onClick={launch} loading={launching} />

              {/* Exercices + séries */}
              {data.exercises && data.exercises.length > 0 && (
                <div className="wdm-exercises">
                  <h3 className="wdm-section-title">Exercices</h3>
                  {groupBySupersets(data.exercises).map((block, blockIdx) => {
                    if (block.type === 'solo') {
                      const ex = block.exercise;
                      const orm = bestOneRepMax(ex.completed_sets);
                      return (
                        <div key={`b-${blockIdx}`} className="wdm-exercise">
                          <div className="wdm-exercise-name-row">
                            <div className="wdm-exercise-name">{renderExName(ex)}</div>
                            {orm && <OneRepMaxBadge value={orm.oneRepMax} />}
                          </div>
                          <div className="wdm-sets">
                            {(ex.completed_sets || []).map((set, idx) => (
                              <div key={idx} className="wdm-set">
                                <span className="wdm-set-num">#{set.set_number}</span>
                                <span className="wdm-set-val">
                                  {set.reps} reps
                                  {set.weight ? ` × ${set.weight}kg` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // type === 'superset'
                    return (
                      <div key={`b-${blockIdx}`} className="wdm-superset-block">
                        <div className="wdm-superset-header">
                          <span className="wdm-superset-icon">🔗</span>
                          Superset · {block.exercises.length} exercices
                        </div>
                        {block.exercises.map((ex, i) => {
                          const orm = bestOneRepMax(ex.completed_sets);
                          return (
                          <div key={ex.id} className="wdm-exercise wdm-exercise--in-superset">
                            <div className="wdm-exercise-name-row">
                              <div className="wdm-exercise-name">
                                <span className="wdm-superset-letter">{supersetLetter(i)}</span>
                                {renderExName(ex)}
                              </div>
                              {orm && <OneRepMaxBadge value={orm.oneRepMax} />}
                            </div>
                            <div className="wdm-sets">
                              {(ex.completed_sets || []).map((set, idx) => (
                                <div key={idx} className="wdm-set">
                                  <span className="wdm-set-num">#{set.set_number}</span>
                                  <span className="wdm-set-val">
                                    {set.reps} reps
                                    {set.weight ? ` × ${set.weight}kg` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Description (notes) — éditable pour ses propres workouts */}
              {(isOwn || data.notes) && (
                <div className="wdm-notes">
                  <div className="wdm-notes-header">
                    <strong>Description</strong>
                    {isOwn && !editingNotes && (
                      <button
                        type="button"
                        className="wdm-notes-edit"
                        onClick={() => { setNotesDraft(data.notes || ''); setEditingNotes(true); }}
                      >
                        {data.notes ? 'Modifier' : '+ Ajouter'}
                      </button>
                    )}
                  </div>
                  {editingNotes ? (
                    <>
                      <textarea
                        className="wdm-notes-textarea"
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        placeholder="Comment s'est passé l'entraînement ?"
                        maxLength={1000}
                        rows={3}
                        autoFocus
                        disabled={notesSaving}
                      />
                      <div className="wdm-notes-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => { setEditingNotes(false); setNotesDraft(data.notes || ''); }}
                          disabled={notesSaving}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          onClick={handleSaveNotes}
                          disabled={notesSaving}
                        >
                          {notesSaving ? '…' : 'Enregistrer'}
                        </button>
                      </div>
                    </>
                  ) : data.notes ? (
                    <div className="wdm-notes-text">"{data.notes}"</div>
                  ) : (
                    <div className="wdm-notes-empty"><em>Aucune description.</em></div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default WorkoutDetailModal;