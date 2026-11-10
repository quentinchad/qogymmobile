import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { userProfileService, friendsService } from '../services/api';
import { useToast } from '../components/Toast';
import WorkoutDetailModal from '../components/WorkoutDetailModal';
import './UserProfile.css';

/**
 * Page profil d'un autre utilisateur (ou le sien si redirection /profile/:id
 * vers son propre id — auquel cas on redirige vers /profile).
 *
 * Affiche : avatar, stats publiques, et l'historique des entraînements (si
 * c'est un ami ou son propre profil). L'historique est paginé : on charge
 * un premier batch via getProfile, puis l'utilisateur peut cliquer sur
 * "Charger plus" pour récupérer 10 entraînements de plus.
 */
const HISTORY_PAGE_SIZE = 10;

const UserProfile = ({ user }) => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [profileData, setProfileData]         = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [friendshipLoading, setFriendshipLoading] = useState(false);

  // Historique paginé (vit séparé de profileData pour pouvoir append sans
  // tout remplacer à chaque clic sur "Charger plus").
  const [history, setHistory]                 = useState([]);
  const [historyHasMore, setHistoryHasMore]   = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  // Modale détail d'un entraînement
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(null);

  useEffect(() => {
    // Si c'est notre propre profil, rediriger vers /profile
    if (user && parseInt(userId) === user.id) {
      navigate('/profile', { replace: true });
      return;
    }
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadProfile = async () => {
    try {
      const response = await userProfileService.getProfile(userId);
      setProfileData(response.data);
      setHistory(response.data?.history || []);
      setHistoryHasMore(!!response.data?.history_has_more);
    } catch (err) {
      console.error('Erreur chargement profil:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Pagination ──
  const loadMoreHistory = async () => {
    if (historyLoadingMore || !historyHasMore) return;
    setHistoryLoadingMore(true);
    try {
      const res = await userProfileService.getMoreHistory(
        userId,
        HISTORY_PAGE_SIZE,
        history.length
      );
      const more = res.data?.history || [];
      setHistory(prev => {
        const seen = new Set(prev.map(w => w.id));
        return [...prev, ...more.filter(w => !seen.has(w.id))];
      });
      setHistoryHasMore(!!res.data?.has_more);
    } catch (err) {
      showToast('Erreur lors du chargement', 'error');
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  // ── Actions amitié ──
  // Refresh complet à chaque changement d'amitié (l'historique peut devenir
  // visible/invisible selon le nouveau statut).
  const refreshAfterFriendshipChange = async () => {
    const response = await userProfileService.getProfile(userId);
    setProfileData(response.data);
    setHistory(response.data?.history || []);
    setHistoryHasMore(!!response.data?.history_has_more);
  };

  const handleSendRequest = async () => {
    setFriendshipLoading(true);
    try {
      await friendsService.sendRequest(parseInt(userId));
      await refreshAfterFriendshipChange();
    } catch (err) {
      console.error('Erreur envoi demande:', err);
    } finally {
      setFriendshipLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!profileData?.friendship_id) return;
    setFriendshipLoading(true);
    try {
      await friendsService.declineRequest(profileData.friendship_id);
      await refreshAfterFriendshipChange();
    } catch (err) {
      console.error('Erreur annulation demande:', err);
    } finally {
      setFriendshipLoading(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!profileData?.friendship_id) return;
    setFriendshipLoading(true);
    try {
      await friendsService.acceptRequest(profileData.friendship_id);
      await refreshAfterFriendshipChange();
    } catch (err) {
      console.error('Erreur acceptation demande:', err);
    } finally {
      setFriendshipLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!profileData?.friendship_id) return;
    if (!window.confirm(`Retirer ${profileData.user.username} de vos amis ?`)) return;
    setFriendshipLoading(true);
    try {
      await friendsService.removeFriend(profileData.friendship_id);
      await refreshAfterFriendshipChange();
    } catch (err) {
      console.error('Erreur suppression ami:', err);
    } finally {
      setFriendshipLoading(false);
    }
  };

  const getAvatar = (targetUser) => {
    if (targetUser.pdp) {
      return (
        <img
          src={`https://qojim.com/pdp/${targetUser.pdp}`}
          alt={targetUser.username}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      );
    }
    return targetUser.username.charAt(0).toUpperCase();
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const formatDateShort = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  // ---------- RENDER FRIENDSHIP BANNER ----------
  const renderFriendshipBanner = () => {
    const { friendship_status, friendship_direction, is_friend } = profileData;

    if (is_friend) {
      return (
        <div className="friendship-banner friend">
          <p className="friendship-banner-text">✓ Vous êtes amis</p>
          <button
            className="btn btn-outline btn-small"
            onClick={handleRemoveFriend}
            disabled={friendshipLoading}
          >
            Retirer
          </button>
        </div>
      );
    }

    if (friendship_status === 'pending') {
      if (friendship_direction === 'sent') {
        return (
          <div className="friendship-banner pending">
            <p className="friendship-banner-text">⏳ Demande envoyée</p>
            <button
              className="btn btn-outline btn-small"
              onClick={handleCancelRequest}
              disabled={friendshipLoading}
            >
              Annuler
            </button>
          </div>
        );
      } else {
        return (
          <div className="friendship-banner pending">
            <p className="friendship-banner-text">
              📩 {profileData.user.username} vous a envoyé une demande d'ami
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary btn-small"
                onClick={handleAcceptRequest}
                disabled={friendshipLoading}
              >
                Accepter
              </button>
              <button
                className="btn btn-outline btn-small"
                onClick={handleCancelRequest}
                disabled={friendshipLoading}
              >
                Refuser
              </button>
            </div>
          </div>
        );
      }
    }

    return (
      <div className="friendship-banner not-friend">
        <p className="friendship-banner-text">
          Vous n'êtes pas encore amis
        </p>
        <button
          className="btn btn-primary btn-small"
          onClick={handleSendRequest}
          disabled={friendshipLoading}
        >
          {friendshipLoading ? '...' : '+ Ajouter'}
        </button>
      </div>
    );
  };

  // ---------- LOADING ----------
  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-screen">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="page-container">
        <p style={{ color: 'var(--text-secondary)' }}>Utilisateur introuvable.</p>
      </div>
    );
  }

  const { user: targetUser, stats, is_friend, is_own_profile } = profileData;

  return (
    <div className="page-container user-profile-page">

      {/* Bouton retour */}
      <button className="btn-back" onClick={() => navigate(-1)}>
        ← Retour
      </button>

      {/* Hero */}
      <div className="card mb-2">
        <div className="profile-hero">
          <div className="profile-hero-avatar">
            {getAvatar(targetUser)}
          </div>
          <div className="profile-hero-info">
            <h1 className="profile-hero-username">{targetUser.username}</h1>
            <p className="profile-hero-joined">
              Membre depuis {formatDate(targetUser.created_at)}
            </p>
          </div>
        </div>

        {/* Bannière amitié */}
        {!is_own_profile && renderFriendshipBanner()}
      </div>

      {/* Stats */}
      <div className="profile-stats-grid">
        <div className="profile-stat-card">
          <div className="profile-stat-value">{stats?.total_workouts || 0}</div>
          <div className="profile-stat-label">Entraînements</div>
        </div>
        <div className="profile-stat-card">
          <div className="profile-stat-value">{stats?.total_days || 0}</div>
          <div className="profile-stat-label">Jours actifs</div>
        </div>
        <div className="profile-stat-card">
          <div className="profile-stat-value">{stats?.total_sets || 0}</div>
          <div className="profile-stat-label">Séries totales</div>
        </div>
        <div className="profile-stat-card">
          <div className="profile-stat-value">{stats?.total_reps || 0}</div>
          <div className="profile-stat-label">Répétitions</div>
        </div>
      </div>

      {/* Bibliothèque d'exercices de l'utilisateur — accessible dans les
          mêmes conditions que l'historique (ami accepté ou profil propre). */}
      {(is_friend || is_own_profile) && (
        <div className="card exlib-link-card">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => navigate(`/exercises/${userId}`)}
          >
            📚 Voir les exercices de {targetUser.username}
          </button>
        </div>
      )}

      {/* Historique */}
      {(is_friend || is_own_profile) ? (
        <div className="card">
          <h3 className="profile-history-title">Derniers entraînements</h3>

          {history.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem 0' }}>
              Aucun entraînement enregistré pour le moment.
            </p>
          ) : (
            <>
              {history.map((workout) => (
                <div
                  key={workout.id}
                  className="profile-workout-card"
                  onClick={() => setSelectedWorkoutId(workout.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedWorkoutId(workout.id);
                    }
                  }}
                >
                  {workout.session_image ? (
                    <img
                      className="profile-workout-image"
                      src={workout.session_image.startsWith('http')
                        ? workout.session_image
                        : `https://qojim.com/imgseances/${workout.session_image}`}
                      alt={workout.session_name}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="profile-workout-image-placeholder">💪</div>
                  )}

                  <div className="profile-workout-info">
                    <div className="profile-workout-name">{workout.session_name}</div>
                    <div className="profile-workout-date">{formatDateShort(workout.completed_at)}</div>
                  </div>

                  <div className="profile-workout-badges">
                    <span className="profile-workout-badge">❤️ {workout.likes_count}</span>
                    <span className="profile-workout-badge">💬 {workout.comments_count}</span>
                  </div>
                </div>
              ))}

              {/* Bouton "Charger plus" */}
              {historyHasMore && (
                <div className="profile-history-load-more">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={loadMoreHistory}
                    disabled={historyLoadingMore}
                  >
                    {historyLoadingMore
                      ? 'Chargement…'
                      : `Charger ${HISTORY_PAGE_SIZE} entraînements de plus`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="private-notice">
            <div className="private-notice-icon">🔒</div>
            <p className="private-notice-text">
              Ajoutez {targetUser.username} en ami pour voir ses entraînements
            </p>
          </div>
        </div>
      )}

      {/* Modale détail entraînement — composant partagé avec Profile et Feed */}
      <WorkoutDetailModal
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
        currentUserId={user?.id}
      />
    </div>
  );
};

export default UserProfile;