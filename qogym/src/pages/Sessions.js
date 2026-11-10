import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { sessionService, qojimService, shareService } from '../services/api';
import ShareSessionModal from '../components/ShareSessionModal';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import './Sessions.css';

/* ------------------------------------------------------------------ */
/* Modale : séances partagées reçues (inbox)                           */
/* ------------------------------------------------------------------ */
const PendingSharesModal = ({ shares, loading, onAccept, onDecline, onClose }) => {
  const [processingId, setProcessingId] = useState(null);

  const handle = async (shareId, action) => {
    setProcessingId(shareId);
    try {
      if (action === 'accept') await onAccept(shareId);
      else await onDecline(shareId);
    } finally {
      setProcessingId(null);
    }
  };

  return ReactDOM.createPortal(
    <div
      className="share-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="share-modal pending-shares-modal">
        <div className="share-modal-header">
          <h2>📥 Séances reçues</h2>
          <button className="share-modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="share-modal-loading">
            <div className="share-spinner"></div>
            <span>Chargement…</span>
          </div>
        ) : shares.length === 0 ? (
          <div className="share-modal-empty">Aucun partage en attente.</div>
        ) : (
          <ul className="pending-shares-list">
            {shares.map((share) => (
              <li key={share.share_id} className="pending-share-item">
                <div className="pending-share-sender-avatar">
                  {share.sender_pdp
                    ? <img src={`https://qojim.com/pdp/${share.sender_pdp}`} alt={share.sender_username} />
                    : <span>{share.sender_username?.charAt(0).toUpperCase()}</span>}
                </div>

                <div className="pending-share-info">
                  <p className="pending-share-from">
                    <strong>{share.sender_username}</strong> veut partager avec toi
                  </p>
                  <div className="pending-share-session-box">
                    {share.session_image && (
                      <img
                        src={share.session_image}
                        alt={share.session_name}
                        className="pending-share-session-img"
                      />
                    )}
                    <div>
                      <p className="pending-share-session-name">{share.session_name}</p>
                      {share.session_type_name && (
                        <p className="pending-share-session-type">{share.session_type_name}</p>
                      )}
                      {share.exercise_count > 0 && (
                        <p className="pending-share-exercise-count">
                          💪 {share.exercise_count} exercice{share.exercise_count > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pending-share-actions">
                  <button
                    className="btn btn-success btn-small"
                    disabled={processingId === share.share_id}
                    onClick={() => handle(share.share_id, 'accept')}
                  >
                    {processingId === share.share_id ? '…' : '✓ Accepter'}
                  </button>
                  <button
                    className="btn btn-danger btn-small"
                    disabled={processingId === share.share_id}
                    onClick={() => handle(share.share_id, 'decline')}
                  >
                    {processingId === share.share_id ? '…' : '✕ Refuser'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="share-modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ------------------------------------------------------------------ */
/* Page principale Sessions                                             */
/* ------------------------------------------------------------------ */
const Sessions = ({ user }) => {
  const [sessions, setSessions]             = useState([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');
  const navigate                            = useNavigate();

  // Share session modal
  const [shareTarget, setShareTarget]       = useState(null);

  // Pending shares inbox
  const [pendingShares, setPendingShares]   = useState([]);
  const [pendingCount, setPendingCount]     = useState(0);
  const [showPending, setShowPending]       = useState(false);
  const [pendingLoading, setPendingLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadSessions();
      loadPendingCount();
    } else {
      setLoading(false);
    }
  }, [user]);

  // Avec le SwipeShell, Sessions n'est jamais démonté → useEffect[user] ne
  // tire qu'une fois. On rafraîchit à chaque retour sur /sessions
  // (typiquement après création/édition de séance, terminaison d'un
  // entraînement libre, ou acceptation d'un partage).
  useRefreshOnFocus('/sessions', () => {
    if (user) {
      loadSessions();
      loadPendingCount();
    }
  });

  /* ---------- loaders ---------- */
  const loadSessions = async () => {
    try {
      const response = await sessionService.getAll();
      setSessions(response.data.sessions);
    } catch (err) {
      setError('Erreur lors du chargement des séances');
    } finally {
      setLoading(false);
    }
  };

  const loadPendingCount = async () => {
    try {
      const res = await shareService.getPendingCount();
      setPendingCount(res.data.count || 0);
    } catch { /* silencieux */ }
  };

  const loadPendingShares = async () => {
    setPendingLoading(true);
    try {
      const res = await shareService.getPending();
      setPendingShares(res.data.pending_shares || []);
    } catch {
      setPendingShares([]);
    } finally {
      setPendingLoading(false);
    }
  };

  /* ---------- handlers séances ---------- */
  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cette séance ?')) return;
    try {
      await sessionService.delete(sessionId);
      setSessions(sessions.filter((s) => s.id !== sessionId));
    } catch {
      alert('Erreur lors de la suppression de la séance');
    }
  };

  const handleRemoveFromLibrary = async (sessionId) => {
    if (!window.confirm('Retirer cette séance Qojim de votre bibliothèque ?')) return;
    try {
      await qojimService.removeFromLibrary(sessionId);
      setSessions(sessions.filter((s) => s.id !== sessionId));
    } catch {
      alert('Erreur lors du retrait de la bibliothèque');
    }
  };

  const handleStartWorkout = (sessionId) => {
    if (!user) { navigate('/login'); return; }
    navigate(`/workout/${sessionId}`);
  };

  /* ---------- séance "libre" (vide) ---------- */
  // Crée une séance template archivée par défaut, sans exos, puis lance
  // l'entraînement dessus. À la fin, l'utilisateur pourra choisir de la
  // garder dans sa galerie (la dé-archiver) ou de la laisser archivée
  // (l'historique reste dans le Feed quoi qu'il arrive).
  const [startingEmpty, setStartingEmpty] = useState(false);
  const handleStartEmptyWorkout = async () => {
    if (!user) { navigate('/login'); return; }
    if (startingEmpty) return;
    setStartingEmpty(true);
    try {
      // Récupérer un type de séance par défaut
      const typesResp = await sessionService.getSessionTypes();
      const types = typesResp.data.types || typesResp.data.session_types || [];
      const defaultType = types[0];
      if (!defaultType) {
        alert("Impossible de créer une séance : aucun type disponible.");
        return;
      }
      // Nom auto basé sur l'heure (cohérent avec le rename qu'on fait à
      // la fin si l'utilisateur choisit "Enregistrer dans la galerie") :
      //   matin / midi / après-midi / soir / nuit
      const h = new Date().getHours();
      const moment =
        h < 5  ? 'de la nuit' :
        h < 12 ? 'du matin' :
        h < 14 ? 'du midi' :
        h < 18 ? 'de l\u2019après-midi' :
        h < 22 ? 'du soir' :
                 'de la nuit';
      const autoName = `Entraînement ${moment}`;
      const fd = new FormData();
      fd.append('name', autoName);
      fd.append('session_type_id', String(defaultType.id));
      fd.append('exercises', JSON.stringify([]));
      // Séance libre : créée déjà archivée. Sera désarchivée à la fin via
      // apply_template_changes UNIQUEMENT si l'utilisateur choisit
      // "Enregistrer dans la galerie". Permet de fermer l'app à tout
      // moment sans polluer la galerie avec des séances orphelines.
      fd.append('is_archived', '1');
      const created = await sessionService.create(fd);
      const newId = created.data.session_id || created.data.id;
      if (!newId) {
        alert("Erreur lors de la création de la séance.");
        return;
      }
      navigate(`/workout/${newId}`, { state: { isEmptyWorkout: true } });
    } catch (err) {
      alert(err.response?.data?.error || "Erreur lors du démarrage d'une séance libre");
    } finally {
      setStartingEmpty(false);
    }
  };

  /* ---------- handlers partage ---------- */
  const openPendingModal = async () => {
    setShowPending(true);
    await loadPendingShares();
  };

  const handleAcceptShare = async (shareId) => {
    try {
      const res = await shareService.accept(shareId);
      setPendingShares((prev) => prev.filter((s) => s.share_id !== shareId));
      setPendingCount((c) => Math.max(0, c - 1));
      if (res.data.new_session_id) await loadSessions();
    } catch (err) {
      const data = err.response?.data || {};
      const message = data.error || "Erreur lors de l'acceptation";
      // Si le serveur a auto-annulé le partage (séance source supprimée par
      // l'expéditeur), on retire localement le partage de la liste pour
      // que l'utilisateur n'essaie pas à nouveau.
      if (data.share_auto_cancelled) {
        setPendingShares((prev) => prev.filter((s) => s.share_id !== shareId));
        setPendingCount((c) => Math.max(0, c - 1));
      }
      alert(message);
    }
  };

  const handleDeclineShare = async (shareId) => {
    try {
      await shareService.decline(shareId);
      setPendingShares((prev) => prev.filter((s) => s.share_id !== shareId));
      setPendingCount((c) => Math.max(0, c - 1));
    } catch (err) {
      // Le decline ne devrait jamais échouer pour une raison "logique" :
      // si le partage n'existe plus côté serveur, c'est qu'il a déjà été
      // traité. On le retire de la liste locale dans tous les cas pour
      // ne pas bloquer l'utilisateur sur un partage fantôme.
      const status = err.response?.status;
      if (status === 404 || status === 410) {
        setPendingShares((prev) => prev.filter((s) => s.share_id !== shareId));
        setPendingCount((c) => Math.max(0, c - 1));
        return;
      }
      alert(err.response?.data?.error || 'Erreur lors du refus');
    }
  };

  /* ---------- rendu ---------- */
  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-screen"><div className="spinner"></div></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Mes Séances</h1>
          <div className="header-buttons">
            <button onClick={() => navigate('/create-session')} className="btn btn-primary">+ Créer</button>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">💪</div>
          <p className="empty-state-text">Aucune séance pour le moment</p>
          <button onClick={() => navigate('/create-session')} className="btn btn-primary">
            Créer ma première séance
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">

      {/* En-tête */}
      <div className="page-header">
        <h1 className="page-title">Mes Séances</h1>
        <div className="header-buttons">
          <button onClick={() => navigate('/create-session')} className="btn btn-primary">
            + Créer
          </button>
        </div>
      </div>

      {/* Bannière notification */}
      {pendingCount > 0 && (
        <div className="share-notification-banner" onClick={openPendingModal}>
          <span className="share-notification-icon">🔔</span>
          <span className="share-notification-text">
            {pendingCount === 1
              ? 'Un ami veut partager une séance avec toi !'
              : `${pendingCount} amis veulent partager des séances avec toi !`}
          </span>
          <span className="share-notification-cta">Voir →</span>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {/* Lancer une séance "libre" (sans template) */}
      <button
        type="button"
        className="empty-workout-cta"
        onClick={handleStartEmptyWorkout}
        disabled={startingEmpty}
      >
        <span className="empty-workout-cta-icon">⚡</span>
        <span className="empty-workout-cta-text">
          <strong>{startingEmpty ? 'Démarrage…' : 'Lancer une séance vide'}</strong>
          <small>Ajoute tes exercices au fur et à mesure</small>
        </span>
        <span className="empty-workout-cta-arrow">→</span>
      </button>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💪</div>
          <p className="empty-state-text">Aucune séance pour le moment</p>
          <button onClick={() => navigate('/create-session')} className="btn btn-primary">
            Créer ma première séance
          </button>
        </div>
      ) : (
        <div className="sessions-grid">
          {sessions.map((session) => {
            const isQojim = session.is_qojim_session === '1' || session.is_qojim_session === 1;
            const isOwner = session.is_owner === '1' || session.is_owner === 1 || session.is_owner === true;
            return (
              <div
                key={session.id}
                className={`card session-card ${session.image_url ? 'with-background-image' : ''}`}
                style={session.image_url ? {
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)),url('${session.image_url}')`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                } : {}}
              >
                {isQojim && (
                  <img
                    src="https://qojim.com/certif.png"
                    alt="Certifié Qojim"
                    className="qojim-certif-badge"
                  />
                )}

                <div className="card-header">
                  <div>
                    <h3 className="card-title">{session.name}</h3>
                    <p className="card-subtitle">{session.session_type_name}</p>
                  </div>
                </div>

                <div className="session-actions">
                  <button
                    className="btn btn-success btn-small"
                    onClick={() => handleStartWorkout(session.id)}
                  >
                    ▶ Démarrer
                  </button>

                  <Link to={`/session/${session.id}`} className="btn btn-outline btn-small">
                    👁️ Voir
                  </Link>

                  {/* Bouton partager – uniquement séances personnelles */}
                  {isOwner && !isQojim && (
                    <button
                      className="btn btn-share btn-small"
                      onClick={() => setShareTarget(session)}
                      title="Partager avec un ami"
                    >
                      🔗 Partager
                    </button>
                  )}

                  {isOwner && !isQojim ? (
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleDeleteSession(session.id)}
                    >
                      🗑️ Supprimer
                    </button>
                  ) : (
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleRemoveFromLibrary(session.id)}
                    >
                      ✕ Retirer
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CTA Qojim — déplacée hors de la nav pour alléger le bandeau du bas.
          Affichée toujours (même si l'utilisateur n'a aucune séance), c'est
          souvent la première chose à essayer pour un nouvel arrivant. */}
      <button
        type="button"
        className="qojim-cta"
        onClick={() => navigate('/qojim')}
      >
        <span className="qojim-cta-icon">🏋️</span>
        <span className="qojim-cta-text">
          <strong>Découvrir les séances Qojim</strong>
          <small>Programmes prêts à l'emploi à ajouter à ta bibliothèque</small>
        </span>
        <span className="qojim-cta-arrow">→</span>
      </button>

      {/* Modale partage sortant */}
      {shareTarget && (
        <ShareSessionModal session={shareTarget} onClose={() => setShareTarget(null)} />
      )}

      {/* Modale inbox partages reçus */}
      {showPending && (
        <PendingSharesModal
          shares={pendingShares}
          loading={pendingLoading}
          onAccept={handleAcceptShare}
          onDecline={handleDeclineShare}
          onClose={() => setShowPending(false)}
        />
      )}
    </div>
  );
};

export default Sessions;