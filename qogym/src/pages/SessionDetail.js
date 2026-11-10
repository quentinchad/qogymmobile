import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { sessionService } from '../services/api';
import { groupBySupersets, supersetLetter } from '../utils/supersets';
import './SessionDetail.css';

/**
 * Liste d'exercices avec le rendu visuel des supersets.
 * Chaque exo garde son numéro global (1, 2, 3…) ; les exos dans un même
 * superset sont entourés d'un cadre vert avec une étiquette "Superset".
 */
const ExercisesPreview = ({ exercises }) => {
  if (!exercises || exercises.length === 0) {
    return <p className="text-secondary">Aucun exercice dans cette séance</p>;
  }
  const blocks = groupBySupersets(exercises);
  return (
    <div className="exercises-list">
      {blocks.map((block, blockIdx) => {
        if (block.type === 'solo') {
          const ex = block.exercise;
          return (
            <div key={`b-${blockIdx}`} className="exercise-item">
              <div className="exercise-number">{block.startIndex + 1}</div>
              <div className="exercise-info">
                <strong>{ex.name}</strong>
                <span className="text-secondary">
                  {ex.sets} séries × {ex.reps_min}
                  {ex.reps_max !== ex.reps_min && `-${ex.reps_max}`} reps
                  • {ex.rest_time}s repos
                </span>
              </div>
            </div>
          );
        }
        // type === 'superset'
        return (
          <div key={`b-${blockIdx}`} className="superset-block">
            <div className="superset-block-header">
              <span className="superset-block-icon">🔗</span>
              Superset · {block.exercises.length} exercices
            </div>
            {block.exercises.map((ex, i) => (
              <div key={ex.id} className="exercise-item exercise-item--in-superset">
                <div className="exercise-superset-letter">{supersetLetter(i)}</div>
                <div className="exercise-info">
                  <strong>{ex.name}</strong>
                  <span className="text-secondary">
                    {ex.sets} séries × {ex.reps_min}
                    {ex.reps_max !== ex.reps_min && `-${ex.reps_max}`} reps
                    • {ex.rest_time}s repos
                  </span>
                </div>
                {i < block.exercises.length - 1 && (
                  <div className="superset-connector-mini" aria-hidden="true">↻</div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

const SessionDetail = ({ user }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession();
  }, [id]);

  const loadSession = async () => {
    try {
      const response = await sessionService.getById(id);
      setSession(response.data.session);
    } catch (err) {
      console.error('Erreur lors du chargement de la séance', err);
    } finally {
      setLoading(false);
    }
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

  if (!session) {
    return (
      <div className="page-container">
        <p>Séance non trouvée</p>
        <Link to="/sessions" className="btn btn-primary">Retour aux séances</Link>
      </div>
    );
  }

  // Si l'utilisateur est propriétaire, permettre la modification (mais pas pour les séances Qojim)
  const isOwner = session.is_owner === '1' || session.is_owner === 1;
  const isQojimSession = (session.is_qojim_session === '1' || session.is_qojim_session === 1);
  
  if (isOwner && !isQojimSession) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">{session.name}</h1>
          <div className="flex gap-2">
            <Link to="/sessions" className="btn btn-secondary">Retour</Link>
            <Link to={`/create-session/${id}`} className="btn btn-primary">✏️ Modifier</Link>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-subtitle">Type: {session.session_type_name}</p>
              {session.is_qojim_session === '1' && (
                <span className="badge badge-certified">✓ Séance Certifiée</span>
              )}
            </div>
          </div>

          <h3 className="mt-2 mb-1">Exercices</h3>
          <ExercisesPreview exercises={session.exercises} />

          <button
            className="btn btn-success mt-2"
            onClick={() => navigate(`/workout/${id}`)}
          >
            ▶ Démarrer cette séance
          </button>
        </div>
      </div>
    );
  }

  // Sinon, simple preview

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">{session.name}</h1>
        <Link to="/sessions" className="btn btn-secondary">Retour</Link>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <p className="card-subtitle">Type: {session.session_type_name}</p>
            {session.is_qojim_session === '1' && (
              <span className="badge badge-certified">✓ Séance Certifiée</span>
            )}
          </div>
        </div>

        <h3 className="mt-2 mb-1">Exercices</h3>
        <ExercisesPreview exercises={session.exercises} />

        <button
          className="btn btn-success mt-2"
          onClick={() => navigate(`/workout/${id}`)}
        >
          ▶ Démarrer cette séance
        </button>
      </div>
    </div>
  );
};

export default SessionDetail;