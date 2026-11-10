import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { feedService, friendsService, monthlyReportService, workoutService } from '../services/api';
import FriendsModal from '../components/FriendsModal';
import StepsCard from '../components/StepsCard';
import { useToast } from '../components/Toast';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { groupBySupersets, supersetLetter } from '../utils/supersets';
import { bestOneRepMax } from '../utils/oneRepMax';
import OneRepMaxBadge from '../components/OneRepMaxBadge';
import { useWorkoutLaunch, LaunchWorkoutButton, WorkoutMenu } from '../components/WorkoutLaunchActions';
import './Feed.css';

const Feed = ({ user }) => {
  const navigate = useNavigate();

  // Ouvre la page de progression d'un exercice pour l'auteur de la séance
  // affichée (ferme d'abord la modale de détail).
  const openExercise = (name) => {
    if (!selectedWorkout || !name) return;
    const uid = selectedWorkout.user_id;
    setSelectedWorkout(null);
    navigate(`/exercises/${uid}/${encodeURIComponent(name)}`);
  };
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedWorkout, setSelectedWorkout] = useState(null);

  // Lancer la séance affichée / l'enregistrer dans la bibliothèque
  const { launch, launching, saveToLibrary, saving, saved } = useWorkoutLaunch({
    workout: selectedWorkout,
    onNavigate: () => setSelectedWorkout(null),
  });
  const [newComment, setNewComment] = useState('');
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [pendingReport, setPendingReport] = useState(null); // {year, month} ou null
  // Nombre de demandes d'amis reçues en attente — utilisé pour afficher
  // une pastille rouge sur l'icône "amis" du header.
  const [pendingFriendsCount, setPendingFriendsCount] = useState(0);

  // Réponse à un commentaire : { id, username } du commentaire parent ciblé,
  // ou null si on écrit un commentaire racine. Quand non-null, le formulaire
  // d'envoi affiche "Réponse à @username" avec un bouton pour annuler.
  const [replyingTo, setReplyingTo] = useState(null);

  // Édition de la description du workout (notes) — uniquement pour ses propres workouts
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft]     = useState('');
  const [notesSaving, setNotesSaving]   = useState(false);

  const { showToast } = useToast();

  const LIMIT = 10;

  // Charge le nombre de demandes d'amis reçues. Utilisé pour le badge sur
  // l'icône amis du header. Best-effort : en cas d'erreur réseau on garde la
  // valeur courante plutôt que d'afficher 0 (qui masquerait le badge à tort).
  const loadPendingFriendsCount = () => {
    friendsService.getPendingReceived()
      .then(res => setPendingFriendsCount((res.data?.pending_requests || []).length))
      .catch(() => {});
  };

  useEffect(() => {
    if (user) {
      loadFeed();
      loadPendingFriendsCount();
      // Vérifie s'il y a un rapport mensuel non consulté
      monthlyReportService.getPending()
        .then(res => setPendingReport(res.data?.pending || null))
        .catch(() => {});
    } else {
      setLoading(false);
    }
  }, [user]);

  // Avec le SwipeShell, Feed n'est jamais démonté → useEffect[user] ne tire
  // qu'une fois. On rafraîchit donc à chaque retour sur /feed (typiquement
  // après avoir terminé un workout).
  useRefreshOnFocus('/feed', () => {
    if (user) {
      loadFeed();
      loadPendingFriendsCount();
      monthlyReportService.getPending()
        .then(res => setPendingReport(res.data?.pending || null))
        .catch(() => {});
    }
  });

  // Gérer le scroll de la page quand la modale est ouverte
  useEffect(() => {
    if (selectedWorkout) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }

    // Nettoyer lors du démontage
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [selectedWorkout]);

  // Reset l'édition de la description quand on change de workout
  useEffect(() => {
    setEditingNotes(false);
    setNotesDraft(selectedWorkout?.notes || '');
  }, [selectedWorkout?.id]);

  const loadFeed = async () => {
    try {
      setLoading(true);
      const response = await feedService.getFeed(LIMIT, 0);
      if (response.data.success) {
        setWorkouts(response.data.workouts);
        setHasMore(response.data.workouts.length === LIMIT);
      }
    } catch (err) {
      console.error('Erreur lors du chargement du feed:', err);
      setError('Impossible de charger le feed');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    try {
      const newOffset = offset + LIMIT;
      const response = await feedService.getFeed(LIMIT, newOffset);
      if (response.data.success) {
        setWorkouts([...workouts, ...response.data.workouts]);
        setOffset(newOffset);
        setHasMore(response.data.workouts.length === LIMIT);
      }
    } catch (err) {
      console.error('Erreur lors du chargement supplémentaire:', err);
    }
  };

  const handleStartEditNotes = () => {
    setNotesDraft(selectedWorkout?.notes || '');
    setEditingNotes(true);
  };
  const handleCancelEditNotes = () => {
    setEditingNotes(false);
    setNotesDraft(selectedWorkout?.notes || '');
  };
  const handleSaveNotes = async () => {
    if (!selectedWorkout) return;
    setNotesSaving(true);
    try {
      const trimmed = notesDraft.trim();
      await workoutService.updateNotes(selectedWorkout.id, trimmed);
      // Met à jour la modale + le feed sans recharger
      setSelectedWorkout(sw => sw ? { ...sw, notes: trimmed } : sw);
      setWorkouts(ws => ws.map(w =>
        w.id === selectedWorkout.id ? { ...w, notes: trimmed } : w
      ));
      setEditingNotes(false);
      showToast('Description mise à jour', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de la mise à jour', 'error');
    } finally {
      setNotesSaving(false);
    }
  };

  const handleLike = async (workoutId, isLiked) => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      if (isLiked) {
        await feedService.unlikeWorkout(workoutId);
      } else {
        await feedService.likeWorkout(workoutId);
      }
      setWorkouts(workouts.map(w => 
        w.id === workoutId 
          ? {
              ...w,
              user_has_liked: !isLiked,
              likes_count: isLiked ? w.likes_count - 1 : w.likes_count + 1
            }
          : w
      ));
    } catch (err) {
      console.error('Erreur lors du like:', err);
    }
  };

  const handleOpenWorkout = async (workoutId) => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      const response = await feedService.getWorkoutDetail(workoutId);
      if (response.data.success) {
        setSelectedWorkout(response.data.workout);
        setNewComment('');
        setReplyingTo(null);
      }
    } catch (err) {
      console.error('Erreur lors du chargement des détails:', err);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      // Si on est en train de répondre à un commentaire, on passe son id
      // au backend qui se chargera de la liaison + de la notif appropriée.
      await feedService.addComment(
        selectedWorkout.id,
        newComment,
        replyingTo?.id || null
      );
      const response = await feedService.getWorkoutDetail(selectedWorkout.id);
      if (response.data.success) {
        setSelectedWorkout(response.data.workout);
        setNewComment('');
        setReplyingTo(null);
      }
    } catch (err) {
      console.error('Erreur lors de l\'ajout du commentaire:', err);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Supprimer ce commentaire ?')) return;

    try {
      await feedService.deleteComment(commentId);
      const response = await feedService.getWorkoutDetail(selectedWorkout.id);
      if (response.data.success) {
        setSelectedWorkout(response.data.workout);
      }
    } catch (err) {
      console.error('Erreur lors de la suppression du commentaire:', err);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins}m`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    
    return date.toLocaleDateString('fr-FR');
  };

  const getInitials = (username) => {
    return username ? username.charAt(0).toUpperCase() : '?';
  };

  const getAvatarUrl = (pdp) => {
    return pdp ? `https://qojim.com/pdp/${pdp}` : null;
  };

  const renderAvatar = (username, pdp, size = 'medium') => {
    const avatarUrl = getAvatarUrl(pdp);
    const sizeClass = size === 'small' ? 'avatar-small' : 'avatar';
    
    if (avatarUrl) {
      return (
        <div className={sizeClass} style={{ backgroundImage: `url('${avatarUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
          <img 
            src={avatarUrl} 
            alt={username} 
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'none' }}
          />
        </div>
      );
    }
    
    return <div className={sizeClass}>{getInitials(username)}</div>;
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Feed</h1>
        </div>
        <div className="loading">Chargement du feed...</div>
      </div>
    );
  }

  // État non connecté - Message propre
  if (!user) {
    return (
      <div className="page-container">
        <div className="page-header">
          
            <h1 className="page-title">Feed</h1>
          
        </div>

        <div className="feed-container">
          <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <p className="empty-state-text">
              Connectez-vous pour voir l'activité de vos amis 💪
            </p>
            <button 
              className="btn btn-primary"
              onClick={() => navigate('/login')}
              style={{ fontSize: '16px' }}
            >
              Se connecter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // État connecté
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Feed</h1>
        <div className="header-buttons">
          <button 
            className="btn btn-friends-icon"
            onClick={() => setShowFriendsModal(true)}
            title={pendingFriendsCount > 0
              ? `${pendingFriendsCount} demande${pendingFriendsCount > 1 ? 's' : ''} d'ami en attente`
              : 'Gestion des amis'}
          >
            <img src="https://qojim.com/icones/friends.png" alt="Amis" className="friends-icon" />
            {/* Pastille rouge avec compteur — visible seulement s'il y a des
                demandes en attente. "9+" au-delà de 9 pour rester lisible. */}
            {pendingFriendsCount > 0 && (
              <span
                className="friends-badge"
                aria-label={`${pendingFriendsCount} demandes d'ami en attente`}
              >
                {pendingFriendsCount > 9 ? '9+' : pendingFriendsCount}
              </span>
            )}
          </button>
          <Link to="/sessions" className="btn btn-primary">
            S'entraîner
          </Link>
        </div>
      </div>

      {/* Compteur de pas du jour — masquable (choix persistant) */}
      <StepsCard />

      {/* Bannière "rapport mensuel disponible" */}
      {pendingReport && (() => {
        const monthNames = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
          'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        return (
          <div
            className="share-notification-banner"
            onClick={() => navigate(`/monthly-report/${pendingReport.year}/${pendingReport.month}`)}
          >
            <span className="share-notification-icon">📊</span>
            <span className="share-notification-text">
              Votre rapport mensuel de <strong>{monthNames[pendingReport.month]} {pendingReport.year}</strong> est disponible !
            </span>
            <span className="share-notification-cta">Voir →</span>
          </div>
        );
      })()}

      <div className="feed-container">
        {error && <div className="error-message">{error}</div>}

        {workouts.length === 0 ? (
          <div className="empty">
            <p>Aucun entraînement à afficher. Commencez à suivre vos amis ! 💪</p>
          </div>
        ) : (
          <>
            <div className="workouts-list">
              {workouts.map((workout) => (
                <div 
                  key={workout.id} 
                  className="card workout-card"
                  onClick={() => handleOpenWorkout(workout.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="workout-header">
                    <div
                      onClick={(e) => { e.stopPropagation(); navigate(`/user/${workout.user_id}`); }}
                      style={{ cursor: 'pointer' }}
                    >
                      {renderAvatar(workout.user_username, workout.user_pdp)}
                    </div>
                    <div className="workout-info">
                      <div
                        className="username"
                        onClick={(e) => { e.stopPropagation(); navigate(`/user/${workout.user_id}`); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {workout.user_username}
                      </div>
                      <div className="workout-time">
                        {new Date(workout.completed_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>

                  {workout.session_image && (
                    <img
                      src={workout.session_image}
                      alt={workout.session_name}
                      className="session-image"
                    />
                  )}

                  <h3 className="session-name">{workout.session_name}</h3>

                  <div className="session-type">{workout.session_type_name}</div>

                  {workout.participants && (
                    <div className="participants">
                      <strong>Participants:</strong> {workout.participants}
                    </div>
                  )}

                  {workout.notes && (
                    <div className="notes">"{workout.notes}"</div>
                  )}

                  <div className="actions">
                    <button
                      className={`action-btn ${workout.user_has_liked ? 'liked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLike(workout.id, workout.user_has_liked);
                      }}
                    >
                      <span>❤️</span>
                      <span>{workout.likes_count}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="load-more-container">
                <button className="btn btn-secondary" onClick={loadMore}>
                  Charger plus d'entraînements
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal détails — rendue dans un portail sur document.body pour
          échapper au transform du SwipeShell qui casserait position:fixed */}
      {selectedWorkout && ReactDOM.createPortal(
        <div className="modal active" onClick={() => setSelectedWorkout(null)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Détails de l'entraînement</h2>
              <div className="wla-header-actions">
                <WorkoutMenu onSave={saveToLibrary} saving={saving} saved={saved} />
                <button
                  className="close-btn"
                  onClick={() => setSelectedWorkout(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="workout-header">
                <div
                  onClick={() => { setSelectedWorkout(null); navigate(`/user/${selectedWorkout.user_id}`); }}
                  style={{ cursor: 'pointer' }}
                >
                  {renderAvatar(selectedWorkout.user_username, selectedWorkout.user_pdp)}
                </div>
                <div className="workout-info">
                  <div
                    className="username"
                    onClick={() => { setSelectedWorkout(null); navigate(`/user/${selectedWorkout.user_id}`); }}
                    style={{ cursor: 'pointer' }}
                  >
                    {selectedWorkout.user_username}
                  </div>
                  <div className="workout-time">
                    {new Date(selectedWorkout.completed_at).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>

              {selectedWorkout.session_image && (
                <img
                  src={selectedWorkout.session_image}
                  alt={selectedWorkout.session_name}
                  className="session-image"
                  style={{ marginTop: '16px' }}
                />
              )}

              <h3 className="session-name" style={{ marginTop: '16px' }}>
                {selectedWorkout.session_name}
              </h3>

              <div className="session-type">
                {selectedWorkout.session_type_name}
              </div>

              <LaunchWorkoutButton onClick={launch} loading={launching} />

              {selectedWorkout.exercises && selectedWorkout.exercises.length > 0 && (
                <div className="exercises-section">
                  <h4>Exercices</h4>
                  {groupBySupersets(selectedWorkout.exercises).map((block, blockIdx) => {
                    if (block.type === 'solo') {
                      const exercise = block.exercise;
                      const orm = bestOneRepMax(exercise.completed_sets);
                      return (
                        <div key={`b-${blockIdx}`} className="exercise-item1">
                          <div className="exercise-name-row">
                            <div className="exercise-name">
                              <span
                                className="exercise-name-link"
                                role="link"
                                tabIndex={0}
                                onClick={() => openExercise(exercise.exercise_name)}
                                onKeyDown={(e) => { if (e.key === 'Enter') openExercise(exercise.exercise_name); }}
                              >
                                {exercise.exercise_name}
                              </span>
                            </div>
                            {orm && <OneRepMaxBadge value={orm.oneRepMax} />}
                          </div>
                          <div className="exercise-sets">
                            {exercise.completed_sets.map((set, idx) => (
                              <div key={idx} className="set-info">
                                <span className="set-label">Série {set.set_number}:</span>
                                <span className="set-value">{set.reps} reps × {set.weight}kg</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // type === 'superset'
                    return (
                      <div key={`b-${blockIdx}`} className="feed-superset-block">
                        <div className="feed-superset-header">
                          <span className="feed-superset-icon">🔗</span>
                          Superset · {block.exercises.length} exercices
                        </div>
                        {block.exercises.map((exercise, i) => {
                          const orm = bestOneRepMax(exercise.completed_sets);
                          return (
                          <div key={exercise.id} className="exercise-item1 exercise-item1--in-superset">
                            <div className="exercise-name-row">
                              <div className="exercise-name">
                                <span className="feed-superset-letter">{supersetLetter(i)}</span>
                                <span
                                  className="exercise-name-link"
                                  role="link"
                                  tabIndex={0}
                                  onClick={() => openExercise(exercise.exercise_name)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') openExercise(exercise.exercise_name); }}
                                >
                                  {exercise.exercise_name}
                                </span>
                              </div>
                              {orm && <OneRepMaxBadge value={orm.oneRepMax} />}
                            </div>
                            <div className="exercise-sets">
                              {exercise.completed_sets.map((set, idx) => (
                                <div key={idx} className="set-info">
                                  <span className="set-label">Série {set.set_number}:</span>
                                  <span className="set-value">{set.reps} reps × {set.weight}kg</span>
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

              {/* Description du workout — éditable pour ses propres workouts.
                  Pour les workouts d'autres utilisateurs : affichage simple. */}
              {(() => {
                const isOwn = user && selectedWorkout.user_id === user.id;
                const hasNotes = !!selectedWorkout.notes;
                if (!isOwn && !hasNotes) return null;

                return (
                  <div className="workout-notes-section" style={{ marginTop: '16px' }}>
                    <div className="workout-notes-header">
                      <strong>Description</strong>
                      {isOwn && !editingNotes && (
                        <button
                          type="button"
                          className="workout-notes-edit-btn"
                          onClick={handleStartEditNotes}
                          title={hasNotes ? 'Modifier la description' : 'Ajouter une description'}
                          aria-label={hasNotes ? 'Modifier la description' : 'Ajouter une description'}
                        >
                          {hasNotes ? '✏️' : '+ Ajouter'}
                        </button>
                      )}
                    </div>

                    {editingNotes ? (
                      <div className="workout-notes-edit">
                        <textarea
                          className="workout-notes-textarea"
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          placeholder="Comment s'est passé l'entraînement ?"
                          maxLength={1000}
                          rows={3}
                          autoFocus
                          disabled={notesSaving}
                        />
                        <div className="workout-notes-edit-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={handleCancelEditNotes}
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
                            {notesSaving ? '...' : 'Enregistrer'}
                          </button>
                        </div>
                      </div>
                    ) : hasNotes ? (
                      <div className="notes">"{selectedWorkout.notes}"</div>
                    ) : (
                      <div className="workout-notes-empty">
                        <em>Aucune description.</em>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Likes */}
              <div className="likes-section">
                <button
                  className={`action-btn ${selectedWorkout.user_has_liked ? 'liked' : ''}`}
                  onClick={() => {
                    handleLike(selectedWorkout.id, selectedWorkout.user_has_liked);
                    setSelectedWorkout({
                      ...selectedWorkout,
                      user_has_liked: !selectedWorkout.user_has_liked,
                      likes_count: selectedWorkout.user_has_liked
                        ? selectedWorkout.likes_count - 1
                        : selectedWorkout.likes_count + 1
                    });
                  }}
                >
                  <span>❤️</span>
                  <span>{selectedWorkout.likes_count}</span>
                </button>
              </div>

              {/* Commentaires */}
              <div className="comments-section">
                <h4>Commentaires ({selectedWorkout.comments.length})</h4>

                {selectedWorkout.comments.length === 0 ? (
                  <p style={{ color: '#7f8c8d', fontSize: '14px' }}>
                    Aucun commentaire pour l'instant
                  </p>
                ) : (() => {
                  // Regroupe les commentaires : racines (parent_comment_id null)
                  // et leurs réponses associées. Le backend retourne tout à
                  // plat, on construit la hiérarchie côté client.
                  const roots   = selectedWorkout.comments.filter(c => !c.parent_comment_id);
                  const replies = selectedWorkout.comments.filter(c => !!c.parent_comment_id);
                  const repliesByParent = replies.reduce((acc, r) => {
                    const k = r.parent_comment_id;
                    (acc[k] = acc[k] || []).push(r);
                    return acc;
                  }, {});

                  // Petit composant interne pour ne pas dupliquer l'affichage
                  // d'un commentaire (racine ou réponse). `isReply` ajuste
                  // juste la classe CSS pour l'indentation visuelle.
                  const renderComment = (comment, isReply = false, parentForReplyId = null) => (
                    <div
                      key={comment.id}
                      className={isReply ? 'comment comment--reply' : 'comment'}
                    >
                      <div
                        onClick={() => navigate(`/user/${comment.user_id}`)}
                        style={{ cursor: 'pointer' }}
                      >
                        {renderAvatar(comment.username, comment.user_pdp, 'small')}
                      </div>

                      <div className="comment-content">
                        <div>
                          <span
                            className="comment-username"
                            onClick={() => { navigate(`/user/${comment.user_id}`); }}
                            style={{ cursor: 'pointer' }}
                          >
                            {comment.username}
                          </span>
                          <span className="comment-time">
                            {formatDate(comment.created_at)}
                          </span>
                        </div>
                        <div className="comment-text">{comment.comment}</div>
                        <div className="comment-actions">
                          {/* Répondre : ouvre le formulaire en mode réponse.
                              Pour une réponse, on cible toujours le commentaire
                              racine (parentForReplyId), pour aplatir au niveau
                              backend (cohérent avec la logique d'aplatissement
                              côté PHP). */}
                          <button
                            type="button"
                            className="reply-btn"
                            onClick={() => {
                              const target = isReply
                                ? { id: parentForReplyId, username: comment.username }
                                : { id: comment.id,        username: comment.username };
                              setReplyingTo(target);
                              // Préfixe l'input avec @username pour clarté
                              setNewComment(`@${comment.username} `);
                            }}
                          >
                            Répondre
                          </button>
                          {!!comment.is_owner && (
                            <button
                              className="delete-comment-btn"
                              onClick={() => handleDeleteComment(comment.id)}
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );

                  return roots.map(root => (
                    <React.Fragment key={root.id}>
                      {renderComment(root, false, null)}
                      {(repliesByParent[root.id] || []).map(reply =>
                        renderComment(reply, true, root.id)
                      )}
                    </React.Fragment>
                  ));
                })()}

                {/* Formulaire de commentaire — affiche une bannière "Réponse
                    à @username" si on est en train de répondre. */}
                <div className="comment-form-wrap">
                  {replyingTo && (
                    <div className="reply-banner">
                      <span>
                        Réponse à <strong>@{replyingTo.username}</strong>
                      </span>
                      <button
                        type="button"
                        className="reply-banner-cancel"
                        onClick={() => { setReplyingTo(null); setNewComment(''); }}
                        aria-label="Annuler la réponse"
                      >✕</button>
                    </div>
                  )}
                  <div className="comment-form">
                    <input
                      type="text"
                      className="comment-input"
                      placeholder={replyingTo ? 'Écris ta réponse…' : 'Ajouter un commentaire...'}
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleAddComment();
                        }
                      }}
                    />
                    <button
                      className="btn"
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                    >
                      Envoyer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Friends Modal */}
      <FriendsModal 
        isOpen={showFriendsModal} 
        onClose={() => {
          setShowFriendsModal(false);
          // L'utilisateur vient probablement d'accepter ou refuser des
          // demandes — on rafraîchit le compteur du badge.
          if (user) loadPendingFriendsCount();
        }}
        user={user}
      />
    </div>
  );
};

export default Feed;