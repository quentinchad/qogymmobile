import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { exerciseLibraryService } from '../services/api';
import OneRepMaxBadge from '../components/OneRepMaxBadge';
import './ExerciseLibrary.css';

/**
 * Page "Mes exercices" — bibliothèque des exercices déjà réalisés par un
 * utilisateur (soi-même via le bouton du Profil, ou un ami via sa page
 * profil). Recherche + tri (alphabétique / nb de fois fait / dernière fois).
 * Clic sur un exercice → page de progression détaillée.
 */

const SORTS = [
  { key: 'recent', label: 'Récent' },
  { key: 'alpha',  label: 'A → Z' },
  { key: 'count',  label: 'Nb de fois' },
  { key: 'orm',    label: '1RM' },
];

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

const ExerciseLibrary = ({ user }) => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const targetId = parseInt(userId, 10);
  const isOwn = user && targetId === user.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [libraryUser, setLibraryUser] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('recent');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    exerciseLibraryService.getLibrary(targetId)
      .then((res) => {
        if (cancelled) return;
        setLibraryUser(res.data?.user || null);
        setExercises(res.data?.exercises || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Erreur lors du chargement');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = exercises;
    if (term) {
      list = list.filter((ex) => ex.name.toLowerCase().includes(term));
    }
    const sorted = [...list];
    switch (sortKey) {
      case 'alpha':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        break;
      case 'count':
        sorted.sort((a, b) => b.times_performed - a.times_performed);
        break;
      case 'orm':
        sorted.sort((a, b) => (b.best_one_rep_max || 0) - (a.best_one_rep_max || 0));
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => new Date(b.last_performed_at) - new Date(a.last_performed_at));
        break;
    }
    return sorted;
  }, [exercises, search, sortKey]);

  return (
    <div className="page-container">
      <button className="btn-back" onClick={() => navigate(-1)}>← Retour</button>

      <div className="page-header">
        <div>
          <h1 className="page-title">📚 Mes exercices</h1>
          {!isOwn && libraryUser && (
            <p className="card-subtitle" style={{ marginTop: '0.25rem' }}>
              Bibliothèque de {libraryUser.username}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="loading-screen">
          <div className="spinner"></div>
        </div>
      )}

      {error && !loading && (
        <div className="form-error">{error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="card exlib-toolbar">
            <input
              type="text"
              className="form-input exlib-search"
              placeholder="Rechercher un exercice…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="exlib-sort-tabs">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`exlib-sort-tab${sortKey === s.key ? ' is-active' : ''}`}
                  onClick={() => setSortKey(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {filteredSorted.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏋️</div>
              <p className="empty-state-text">
                {exercises.length === 0
                  ? (isOwn
                    ? "Aucun exercice enregistré pour le moment. Terminez une séance pour commencer à suivre votre progression !"
                    : "Aucun exercice enregistré pour le moment.")
                  : 'Aucun résultat pour cette recherche.'}
              </p>
            </div>
          ) : (
            <div className="exlib-list">
              {filteredSorted.map((ex) => (
                <div
                  key={ex.name}
                  className="card exlib-item"
                  onClick={() => navigate(`/exercises/${targetId}/${encodeURIComponent(ex.name)}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/exercises/${targetId}/${encodeURIComponent(ex.name)}`);
                    }
                  }}
                >
                  <div className="exlib-item-main">
                    <div className="exlib-item-name">{ex.name}</div>
                    <div className="exlib-item-meta">
                      {ex.times_performed} fois · dernière fois le {formatDate(ex.last_performed_at)}
                    </div>
                  </div>
                  {ex.best_one_rep_max != null && (
                    <div className="exlib-item-orm">
                      <OneRepMaxBadge value={ex.best_one_rep_max} />
                    </div>
                  )}
                  <span className="exlib-item-arrow">→</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ExerciseLibrary;