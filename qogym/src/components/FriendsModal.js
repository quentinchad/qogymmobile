import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { friendsService } from '../services/api';
import '../styles/FriendsModal.css';

const FriendsModal = ({ isOpen, onClose, user }) => {
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [pendingReceived, setPendingReceived] = useState([]); // Added this line
  const [pendingSent, setPendingSent] = useState([]); // Added this line
  const [searchResults, setSearchResults] = useState([]); // Added this line
  const [searchTerm, setSearchTerm] = useState(''); // Added this line
  const [activeTab, setActiveTab] = useState('friends'); // Changed from 'received' to 'friends'
  const [loading, setLoading] = useState(false); // Added this line
  const tabsContainerRef = React.useRef(null);

  useEffect(() => {
    if (isOpen && user) {
      loadData();
    }
  }, [isOpen, user]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [friendsRes, pendingRes, sentRes] = await Promise.all([
        friendsService.getFriends(),
        friendsService.getPendingReceived(),
        friendsService.getPendingSent()
      ]);

      if (friendsRes.data.success) setFriends(friendsRes.data.friends);
      if (pendingRes.data.success) setPendingReceived(pendingRes.data.pending_requests);
      if (sentRes.data.success) setPendingSent(sentRes.data.sent_requests);
    } catch (err) {
      console.error('Erreur lors du chargement des amis:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await friendsService.searchUsers(searchTerm);
      if (response.data.success) {
        setSearchResults(response.data.users);
      }
    } catch (err) {
      console.error('Erreur lors de la recherche:', err);
    }
  };

  const handleSendRequest = async (userId) => {
    try {
      await friendsService.sendRequest(userId);
      setSearchTerm('');
      setSearchResults([]);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de l\'envoi de la demande');
    }
  };

  const handleAccept = async (friendshipId) => {
    try {
      await friendsService.acceptRequest(friendshipId);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de l\'acceptation');
    }
  };

  const handleDecline = async (friendshipId) => {
    try {
      await friendsService.declineRequest(friendshipId);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du refus');
    }
  };

  const handleRemove = async (friendshipId) => {
    if (!window.confirm('Retirer cet ami ?')) return;

    try {
      await friendsService.removeFriend(friendshipId);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  };

  const getInitials = (username) => {
    return username ? username.charAt(0).toUpperCase() : '?';
  };

  const getProfilePhotoUrl = (pdp) => {
    if (!pdp) return null;
    return `https://qojim.com/pdp/${pdp}`;
  };

  if (!isOpen) return null;

  // État non connecté
  if (!user) {
    return ReactDOM.createPortal(
      <div className="friends-modal-overlay" onClick={onClose}>
        <div className="friends-modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="friends-modal-header">
            <h2>👥 Gestion des amis</h2>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="friends-modal-body" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔒</div>
            <h3 style={{ marginBottom: '12px', color: '#1a1a2e' }}>Connexion requise</h3>
            <p style={{ marginBottom: '24px', color: '#7f8c8d' }}>
              Connectez-vous pour ajouter des amis et voir leurs entraînements
            </p>
            <button 
              className="btn btn-primary"
              onClick={() => {
                onClose();
                navigate('/login');
              }}
            >
              Se connecter
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // État connecté
  return ReactDOM.createPortal(
    <div className="friends-modal-overlay" onClick={onClose}>
      <div className="friends-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2>👥 Gestion des amis</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="friends-modal-body">
          {/* Tabs */}
          <div className="friends-tabs-container">
            <div className="friends-tabs">
              <button
                className={`friends-tab ${activeTab === 'received' ? 'active' : ''}`}
                onClick={() => setActiveTab('received')}
              >
                📬 Reçues ({pendingReceived.length})
              </button>
              <button
                className={`friends-tab ${activeTab === 'friends' ? 'active' : ''}`}
                onClick={() => setActiveTab('friends')}
              >
                👥 Amis ({friends.length})
              </button>
              <button
                className={`friends-tab ${activeTab === 'sent' ? 'active' : ''}`}
                onClick={() => setActiveTab('sent')}
              >
                📤 Envoyées ({pendingSent.length})
              </button>
              <button
                className={`friends-tab ${activeTab === 'search' ? 'active' : ''}`}
                onClick={() => setActiveTab('search')}
              >
                🔍 Chercher
              </button>
            </div>
          </div>

          {/* Tab: Demandes reçues */}
          {activeTab === 'received' && (
            <div className="friends-tab-content">
              {loading ? (
                <div className="friends-loading">Chargement...</div>
              ) : pendingReceived.length === 0 ? (
                <p className="friends-empty">Aucune demande reçue</p>
              ) : (
                <div className="friends-list">
                  {pendingReceived.map((request) => (
                    <div key={request.friendship_id} className="friend-item">
                      <div
                        className="friend-avatar"
                        onClick={() => { onClose(); navigate(`/user/${request.sender_id}`); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {request.sender_pdp ? (
                          <img src={getProfilePhotoUrl(request.sender_pdp)} alt={request.sender_username} className="avatar-img" />
                        ) : (
                          getInitials(request.sender_username)
                        )}
                      </div>
                      <div className="friend-info">
                        <div
                          className="friend-username"
                          onClick={() => { onClose(); navigate(`/user/${request.sender_id}`); }}
                          style={{ cursor: 'pointer' }}
                        >{request.sender_username}</div>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => handleAccept(request.friendship_id)}
                        >
                          ✓
                        </button>
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => handleDecline(request.friendship_id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Amis */}
          {activeTab === 'friends' && (
            <div className="friends-tab-content">
              {loading ? (
                <div className="friends-loading">Chargement...</div>
              ) : friends.length === 0 ? (
                <p className="friends-empty">Aucun ami pour le moment</p>
              ) : (
                <div className="friends-list">
                  {friends.map((friend) => (
                    <div key={friend.friendship_id} className="friend-item">
                      <div
                        className="friend-avatar"
                        onClick={() => { onClose(); navigate(`/user/${friend.friend_id}`); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {friend.friend_pdp ? (
                          <img src={getProfilePhotoUrl(friend.friend_pdp)} alt={friend.friend_username} className="avatar-img" />
                        ) : (
                          getInitials(friend.friend_username)
                        )}
                      </div>
                      <div className="friend-info">
                        <div
                          className="friend-username"
                          onClick={() => { onClose(); navigate(`/user/${friend.friend_id}`); }}
                          style={{ cursor: 'pointer' }}
                        >{friend.friend_username}</div>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => handleRemove(friend.friendship_id)}
                        >
                          Retirer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Demandes envoyées */}
          {activeTab === 'sent' && (
            <div className="friends-tab-content">
              {loading ? (
                <div className="friends-loading">Chargement...</div>
              ) : pendingSent.length === 0 ? (
                <p className="friends-empty">Aucune demande envoyée</p>
              ) : (
                <div className="friends-list">
                  {pendingSent.map((request) => (
                    <div key={request.friendship_id} className="friend-item">
                      <div
                        className="friend-avatar"
                        onClick={() => { onClose(); navigate(`/user/${request.receiver_id}`); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {request.receiver_pdp ? (
                          <img src={getProfilePhotoUrl(request.receiver_pdp)} alt={request.receiver_username} className="avatar-img" />
                        ) : (
                          getInitials(request.receiver_username)
                        )}
                      </div>
                      <div className="friend-info">
                        <div
                          className="friend-username"
                          onClick={() => { onClose(); navigate(`/user/${request.receiver_id}`); }}
                          style={{ cursor: 'pointer' }}
                        >{request.receiver_username}</div>
                        <div className="friend-status">En attente...</div>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => handleRemove(request.friendship_id)}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Chercher */}
          {activeTab === 'search' && (
            <div className="friends-tab-content">
              <div className="friends-search-box">
                <input
                  type="text"
                  className="friends-search-input"
                  placeholder="Rechercher un utilisateur..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button className="btn btn-primary btn-small" onClick={handleSearch}>
                  🔍
                </button>
              </div>

              {searchResults.length === 0 && searchTerm ? (
                <p className="friends-empty">Aucun utilisateur trouvé</p>
              ) : (
                <div className="friends-list">
                  {searchResults.map((user) => (
                    <div key={user.id} className="friend-item">
                      <div
                        className="friend-avatar"
                        onClick={() => { onClose(); navigate(`/user/${user.id}`); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {user.pdp ? (
                          <img src={getProfilePhotoUrl(user.pdp)} alt={user.username} className="avatar-img" />
                        ) : (
                          getInitials(user.username)
                        )}
                      </div>
                      <div className="friend-info">
                        <div
                          className="friend-username"
                          onClick={() => { onClose(); navigate(`/user/${user.id}`); }}
                          style={{ cursor: 'pointer' }}
                        >{user.username}</div>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => handleSendRequest(user.id)}
                        >
                          + Ajouter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default FriendsModal;