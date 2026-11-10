import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { friendsService, shareService } from '../services/api';
import './ShareSessionModal.css';

const ShareSessionModal = ({ session, onClose }) => {
  const [friends, setFriends]           = useState([]);
  const [selected, setSelected]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [sending, setSending]           = useState(false);
  const [success, setSuccess]           = useState('');
  const [error, setError]               = useState('');

  useEffect(() => {
    loadFriends();
    // Fermer avec Echap
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadFriends = async () => {
    try {
      const res = await friendsService.getFriends();
      setFriends(res.data.friends || []);
    } catch {
      setError('Impossible de charger la liste d\'amis.');
    } finally {
      setLoading(false);
    }
  };

  const toggleFriend = (friendId) => {
    setSelected((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]
    );
  };

  const handleShare = async () => {
    if (selected.length === 0) return;
    setSending(true);
    setError('');
    try {
      const res = await shareService.shareSession(session.id, selected);
      const count = res.data.shared?.length ?? 0;
      setSuccess(
        count > 0
          ? `✅ Séance partagée avec ${count} ami${count > 1 ? 's' : ''} ! Ils ont reçu un email.`
          : 'Aucun nouveau partage (déjà envoyé ou amis invalides).'
      );
      setSelected([]);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du partage.');
    } finally {
      setSending(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="share-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="share-modal">
        <div className="share-modal-header">
          <h2>Partager la séance</h2>
          <button className="share-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="share-modal-session">
          <span className="share-session-icon">🏋️</span>
          <span className="share-session-name">{session.name}</span>
        </div>

        <p className="share-modal-hint">
          Sélectionne les amis avec qui tu veux partager cette séance.<br />
          Ils pourront l'accepter et l'utiliser comme si ils l'avaient créée eux-mêmes.
        </p>

        {loading ? (
          <div className="share-modal-loading">
            <div className="share-spinner"></div>
            <span>Chargement des amis…</span>
          </div>
        ) : friends.length === 0 ? (
          <div className="share-modal-empty">
            Tu n'as pas encore d'amis. Ajoute des amis depuis le feed pour partager tes séances !
          </div>
        ) : (
          <ul className="share-friends-list">
            {friends.map((f) => {
              const isSelected = selected.includes(f.friend_id);
              return (
                <li
                  key={f.friend_id}
                  className={`share-friend-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleFriend(f.friend_id)}
                >
                  <div className="share-friend-avatar">
                    {f.friend_pdp ? (
                      <img src={`https://qojim.com/pdp/${f.friend_pdp}`} alt={f.friend_username} />
                    ) : (
                      <span>{f.friend_username?.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="share-friend-name">{f.friend_username}</span>
                  <div className={`share-friend-check ${isSelected ? 'checked' : ''}`}>
                    {isSelected ? '✓' : ''}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error   && <div className="share-modal-error">{error}</div>}
        {success && <div className="share-modal-success">{success}</div>}

        <div className="share-modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Fermer</button>
          <button
            className="btn btn-primary"
            onClick={handleShare}
            disabled={selected.length === 0 || sending}
          >
            {sending ? 'Envoi…' : `Partager${selected.length > 0 ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ShareSessionModal;