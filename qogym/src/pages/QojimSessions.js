import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { qojimService } from '../services/api';
import './QojimSessions.css';

const QojimSessions = ({ user }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadQojimSessions();
  }, []);

  const loadQojimSessions = async () => {
    try {
      const response = await qojimService.getAll();
      setSessions(response.data.sessions);
    } catch (err) {
      console.error('Erreur lors du chargement des séances Qojim', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToLibrary = async (sessionId) => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      await qojimService.addToLibrary(sessionId);
      setSessions(sessions.map(s => 
        s.id === sessionId ? { ...s, in_library: true } : s
      ));
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de l\'ajout à la bibliothèque');
    }
  };

  const handleRemoveFromLibrary = async (sessionId) => {
    if (!window.confirm('Retirer cette séance de votre bibliothèque ?')) {
      return;
    }

    try {
      await qojimService.removeFromLibrary(sessionId);
      setSessions(sessions.map(s => 
        s.id === sessionId ? { ...s, in_library: false } : s
      ));
    } catch (err) {
      console.error('Erreur lors du retrait:', err);
      alert(err.response?.data?.error || 'Erreur lors du retrait de la bibliothèque');
    }
  };

  const handleViewDetails = (sessionId) => {
    if (!user) {
      navigate('/login');
      return;
    }
    navigate(`/session/${sessionId}`);
  };

  const handleStartWorkout = (sessionId) => {
    if (!user) {
      navigate('/login');
      return;
    }
    navigate(`/workout/${sessionId}`);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-screen">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Bouton retour : la page Qojim est sortie du carousel principal,
          il faut donc fournir explicitement une issue de secours. */}
      <button className="btn-back" onClick={() => navigate(-1)}>
        ← Retour
      </button>

      <div className="page-header">
        <h1 className="page-title">⭐ Séances Qojim</h1>
      </div>

      <p className="qojim-description">
        Découvrez les séances créées et certifiées par Qojim. 
        {user ? "Ajoutez-les à votre bibliothèque pour les utiliser !" : "Connectez-vous pour les ajouter à votre bibliothèque !"}
      </p>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⭐</div>
          <p className="empty-state-text">Aucune séance Qojim disponible pour le moment</p>
        </div>
      ) : (
        <div className="sessions-grid">
          {sessions.map((session) => (
            <div 
              key={session.id} 
              className={`card qojim-card ${session.image_url ? 'with-background-image' : ''}`}
              style={session.image_url ? {
                backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url('${session.image_url}')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              } : {}}
            >
              <div className="qojim-badge-wrapper">
                <span className="badge badge-certified">
                  ✓ Certifié Qojim
                </span>
              </div>

              <h3 className="card-title">{session.name}</h3>
              <p className="card-subtitle">{session.session_type_name}</p>
              <p className="qojim-creator">Par {session.creator_username}</p>

              <div className="qojim-actions">
                {user && session.in_library ? (
                  <>
                    <button
                      className="btn btn-success btn-small"
                      onClick={() => handleStartWorkout(session.id)}
                    >
                      ▶ Démarrer
                    </button>
                    <button
                      className="btn btn-outline btn-small"
                      onClick={() => handleViewDetails(session.id)}
                    >
                      Voir détails
                    </button>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleRemoveFromLibrary(session.id)}
                    >
                      Retirer
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleAddToLibrary(session.id)}
                    >
                      + Ajouter à ma bibliothèque
                    </button>
                    <button
                      className="btn btn-outline btn-small"
                      onClick={() => handleViewDetails(session.id)}
                    >
                      Voir détails
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QojimSessions;