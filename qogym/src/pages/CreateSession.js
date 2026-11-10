import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { sessionService, adminService } from '../services/api';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import RestTimePicker, { formatRestTime } from '../components/RestTimePicker';
import { groupBySupersets, linkWithNext, unlinkAtIndex, supersetLetter, normalizeOrphans } from '../utils/supersets';
import './CreateSession.css';

const CreateSession = ({ user }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(id ? true : false);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [error, setError] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const fileInputRef = useRef(null);

  const [formData, setFormData] = useState({
    name: '',
    session_type_id: '',
    is_qojim_session: false,
    image_url: '',
    exercises: []
  });

  const [newExercise, setNewExercise] = useState({
    name: '',
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_time: 90
  });

  // Affiche le picker roulant pour le temps de repos du nouvel exo en cours
  const [showRestPicker, setShowRestPicker] = useState(false);

  // ── Autocomplétion du nom d'exercice ──
  // Deux sources : la bibliothèque perso (déjà chargée une fois), et une
  // recherche externe (wger) débattue pendant la frappe. Objectif : éviter
  // de devoir remplir sets/reps/repos à la main à chaque fois qu'on ajoute
  // un exo déjà connu.
  const [exerciseLibrary, setExerciseLibrary] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [externalMatches, setExternalMatches] = useState([]);
  const [externalSearching, setExternalSearching] = useState(false);

  useEffect(() => {
    loadSessionTypes();
    if (user) loadExerciseLibrary();
    
    // Si modification et user connecté, charger la séance
    if (id && user) {
      loadSession();
    }
    
    // Si pas d'ID (création), charger depuis localStorage si non connecté
    if (!id && !user) {
      const savedSession = localStorage.getItem('qogym_pending_session');
      if (savedSession) {
        try {
          const parsed = JSON.parse(savedSession);
          setFormData(parsed);
          if (parsed.image_url) {
            setImagePreview(parsed.image_url);
          }
        } catch (err) {
          console.error('Erreur lors du chargement de la séance temporaire:', err);
        }
      }
    }
  }, [id, user]);

  const loadSessionTypes = async () => {
    try {
      const response = await sessionService.getSessionTypes();
      setSessionTypes(response.data.session_types);
      if (response.data.session_types.length > 0 && !formData.session_type_id) {
        setFormData(prev => ({ ...prev, session_type_id: response.data.session_types[0].id }));
      }
    } catch (err) {
      console.error('Erreur lors du chargement des types de séances', err);
    }
  };

  const loadExerciseLibrary = async () => {
    try {
      const response = await sessionService.getAllExercises();
      setExerciseLibrary(response.data.exercises || []);
    } catch (err) {
      console.error('Erreur lors du chargement de la bibliothèque d\'exercices', err);
    }
  };

  // Matches locaux (bibliothèque perso), filtrés par le nom en cours de
  // frappe. Pas besoin de debounce ici, c'est un filtre en mémoire.
  const localMatches = (() => {
    const term = newExercise.name.trim().toLowerCase();
    if (term.length < 1) return [];
    return exerciseLibrary
      .filter(ex => ex.name.toLowerCase().includes(term))
      .slice(0, 6);
  })();

  // Recherche externe (wger) débattue pendant la frappe, uniquement si
  // connecté (le proxy backend exige l'auth) et à partir de 2 caractères.
  useEffect(() => {
    const term = newExercise.name.trim();
    if (!user || term.length < 2) {
      setExternalMatches([]);
      setExternalSearching(false);
      return;
    }
    setExternalSearching(true);
    const handle = setTimeout(async () => {
      try {
        const response = await sessionService.searchExternalExercises(term);
        setExternalMatches(response.data.results || []);
      } catch (err) {
        setExternalMatches([]);
      } finally {
        setExternalSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newExercise.name, user]);

  const handleExerciseNameChange = (e) => {
    const value = e.target.value;
    setNewExercise(prev => ({ ...prev, name: value }));
    setShowSuggestions(true);
  };

  // Sélection d'un exo depuis la bibliothèque perso : on reprend TOUS ses
  // paramètres (séries/reps/repos), déjà connus et pertinents pour cet exo.
  const handlePickLibraryExercise = (ex) => {
    setNewExercise({
      name: ex.name,
      sets: ex.sets || 3,
      reps_min: ex.reps_min || 8,
      reps_max: ex.reps_max || 12,
      rest_time: ex.rest_time || 90,
    });
    setShowSuggestions(false);
  };

  // Sélection d'un exo depuis wger : seul le nom est fiable (wger ne
  // connaît pas de séries/reps/repos, ce sont des paramètres d'entraînement
  // propres à qojim) — on garde les valeurs déjà saisies pour le reste.
  const handlePickExternalExercise = (ex) => {
    setNewExercise(prev => ({ ...prev, name: ex.name }));
    setShowSuggestions(false);
  };

  const loadSession = async () => {
    try {
      const response = await sessionService.getById(id);
      const session = response.data.session;
      setFormData({
        name: session.name,
        session_type_id: session.session_type_id,
        is_qojim_session: session.is_qojim_session === '1' || session.is_qojim_session === 1,
        image_url: session.image_url || '',
        exercises: session.exercises || []
      });
      if (session.image_url) {
        setImagePreview(session.image_url);
      }
    } catch (err) {
      console.error('Erreur chargement session:', err);
      setError('Erreur lors du chargement de la séance: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Vérifier le type de fichier
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Format d\'image non supporté. Utilisez JPG, PNG, GIF ou WebP.');
      return;
    }

    // Vérifier la taille (max 5 Mo)
    if (file.size > 5 * 1024 * 1024) {
      setError('L\'image ne doit pas dépasser 5 Mo.');
      return;
    }

    setImageFile(file);
    setError('');

    // Générer un aperçu local
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview('');
    setFormData(prev => ({ ...prev, image_url: '' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAddExercise = () => {
    if (!newExercise.name.trim()) {
      alert('Veuillez entrer le nom de l\'exercice');
      return;
    }

    if (editingIndex !== null) {
      // Mode édition: remplacer l'exercice existant
      const updatedExercises = [...formData.exercises];
      updatedExercises[editingIndex] = { ...newExercise };
      setFormData(prev => ({
        ...prev,
        exercises: updatedExercises
      }));
      setEditingIndex(null);
    } else {
      // Mode création: ajouter un nouvel exercice
      setFormData(prev => ({
        ...prev,
        exercises: [...prev.exercises, { ...newExercise }]
      }));
    }

    setNewExercise({
      name: '',
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      rest_time: 90
    });
    setShowSuggestions(false);
  };

  const handleEditExercise = (index) => {
    setNewExercise(formData.exercises[index]);
    setEditingIndex(index);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setNewExercise({
      name: '',
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      rest_time: 90
    });
    setShowSuggestions(false);
  };

  const handleRemoveExercise = (index) => {
    setFormData(prev => ({
      ...prev,
      exercises: normalizeOrphans(prev.exercises.filter((_, i) => i !== index))
    }));
  };

  // Lier l'exo `index` au suivant en superset
  const handleLinkNext = (index) => {
    setFormData(prev => ({ ...prev, exercises: linkWithNext(prev.exercises, index) }));
  };

  // Délier l'exo `index` du superset auquel il appartient
  const handleUnlink = (index) => {
    setFormData(prev => ({ ...prev, exercises: normalizeOrphans(unlinkAtIndex(prev.exercises, index)) }));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const exercises = Array.from(formData.exercises);
    const [removed] = exercises.splice(result.source.index, 1);
    exercises.splice(result.destination.index, 0, removed);

    // Après réorganisation, certains supersets peuvent se retrouver "cassés"
    // (un seul exo restant avec un superset_group sans voisin). On nettoie.
    setFormData(prev => ({ ...prev, exercises: normalizeOrphans(exercises) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Le nom de la séance est requis');
      return;
    }

    if (formData.exercises.length === 0) {
      setError('Ajoutez au moins un exercice');
      return;
    }

    // Si pas connecté, sauvegarder temporairement et rediriger vers login
    if (!user) {
      localStorage.setItem('qogym_pending_session', JSON.stringify(formData));
      localStorage.setItem('qogym_redirect_after_login', '/create-session');
      navigate('/login');
      return;
    }

    // Si connecté, sauvegarder normalement
    setLoading(true);

    try {
      // Construire un FormData pour gérer l'upload de fichier
      const data = new FormData();
      data.append('name', formData.name);
      data.append('session_type_id', formData.session_type_id);
      data.append('is_qojim_session', formData.is_qojim_session ? '1' : '0');
      data.append('exercises', JSON.stringify(formData.exercises));

      if (imageFile) {
        // Nouvelle image sélectionnée depuis l'appareil
        data.append('image', imageFile);
      } else {
        // Pas de nouveau fichier : conserver l'URL existante (si édition)
        data.append('image_url', formData.image_url || '');
      }

      if (id) {
        data.append('id', id);
        await sessionService.update(data);
      } else {
        await sessionService.create(data);
        // Nettoyer le localStorage après sauvegarde réussie
        localStorage.removeItem('qogym_pending_session');
        localStorage.removeItem('qogym_redirect_after_login');
      }
      navigate('/sessions');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setLoading(false);
    }
  };

  // Message si pas connecté et en modification
  if (id && !user) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Modifier une séance</h1>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h2 style={{ marginBottom: '12px', color: '#1a1a2e' }}>Connexion requise</h2>
          <p style={{ marginBottom: '24px', color: '#7f8c8d' }}>
            Connectez-vous pour modifier vos séances
          </p>
          <button 
            className="btn btn-primary"
            onClick={() => navigate('/login')}
          >
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">{id ? 'Modifier' : 'Créer'} une séance</h1>
      </div>

      {loading && (
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Chargement de la séance...</p>
        </div>
      )}

      {error && <div className="form-error mb-2">{error}</div>}

      {!loading && (
        <form onSubmit={handleSubmit}>
          <div className="card mb-2">
            <div className="form-group">
              <label className="form-label">Nom de la séance</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Jour des jambes"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Type de séance</label>
              <select
                className="form-select"
                value={formData.session_type_id}
                onChange={(e) => setFormData({ ...formData, session_type_id: e.target.value })}
                required
              >
                {sessionTypes.map(type => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Image (optionnel)</label>

              {/* Zone d'aperçu et suppression si une image est sélectionnée */}
              {imagePreview ? (
                <div className="image-preview-container" style={{ marginBottom: '10px' }}>
                  <img
                    src={imagePreview}
                    alt="Aperçu"
                    style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px', display: 'block', marginBottom: '8px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    onClick={handleRemoveImage}
                  >
                    ✕ Supprimer l'image
                  </button>
                </div>
              ) : (
                <div
                  className="image-upload-zone"
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  style={{
                    border: '2px dashed #ccc',
                    borderRadius: '8px',
                    padding: '24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    color: '#7f8c8d',
                    marginBottom: '8px',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#999'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#ccc'}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📷</div>
                  <p style={{ margin: 0, fontWeight: 500 }}>Cliquez pour choisir une image</p>
                  <small>JPG, PNG, GIF, WebP — max 5 Mo</small>
                </div>
              )}

              {/* Input file caché */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleImageChange}
              />

              {!imagePreview && (
                <small className="text-secondary">Ajoutez une image depuis votre appareil pour illustrer cette séance</small>
              )}
            </div>

            {user?.is_admin && (
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_qojim_session}
                    onChange={(e) => setFormData({ ...formData, is_qojim_session: e.target.checked })}
                  />
                  <span className="ml-1">Séance Qojim (publique)</span>
                </label>
              </div>
            )}
          </div>

          <div className="card mb-2">
            <h3 className="card-title mb-2">{editingIndex !== null ? '✏️ Modifier l\'exercice' : 'Ajouter un exercice'}</h3>
            
            <div className="form-group exercise-name-search">
              <label className="form-label">Nom de l'exercice</label>
              <input
                type="text"
                className="form-input"
                value={newExercise.name}
                onChange={handleExerciseNameChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setShowSuggestions(false)}
                placeholder="Ex: Squat"
                autoComplete="off"
              />
              {showSuggestions && (localMatches.length > 0 || externalMatches.length > 0 || externalSearching) && (
                <div className="exercise-suggestions-dropdown">
                  {localMatches.length > 0 && (
                    <div className="exercise-suggestions-group">
                      <div className="exercise-suggestions-group-label">Ta bibliothèque</div>
                      {localMatches.map(ex => (
                        <button
                          type="button"
                          key={`lib-${ex.id}`}
                          className="exercise-suggestion-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handlePickLibraryExercise(ex)}
                        >
                          <span className="exercise-suggestion-name">{ex.name}</span>
                          <span className="exercise-suggestion-meta">
                            {ex.sets}×{ex.reps_min}{ex.reps_max && ex.reps_max !== ex.reps_min ? `-${ex.reps_max}` : ''} · {formatRestTime(ex.rest_time || 0)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(externalMatches.length > 0 || externalSearching) && (
                    <div className="exercise-suggestions-group">
                      <div className="exercise-suggestions-group-label">Base d'exercices</div>
                      {externalSearching && (
                        <div className="exercise-suggestions-loading">Recherche…</div>
                      )}
                      {externalMatches.map(ex => (
                        <button
                          type="button"
                          key={`ext-${ex.id || ex.name}`}
                          className="exercise-suggestion-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handlePickExternalExercise(ex)}
                        >
                          <span className="exercise-suggestion-name">{ex.name}</span>
                          {ex.category && <span className="exercise-suggestion-meta">{ex.category}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="exercise-params">
              <div className="form-group">
                <label className="form-label">Séries</label>
                <input
                  type="number"
                  className="form-input"
                  value={newExercise.sets}
                  onChange={(e) => setNewExercise({ ...newExercise, sets: parseInt(e.target.value) })}
                  min="1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Reps min</label>
                <input
                  type="number"
                  className="form-input"
                  value={newExercise.reps_min}
                  onChange={(e) => setNewExercise({ ...newExercise, reps_min: parseInt(e.target.value) })}
                  min="1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Reps max</label>
                <input
                  type="number"
                  className="form-input"
                  value={newExercise.reps_max}
                  onChange={(e) => setNewExercise({ ...newExercise, reps_max: parseInt(e.target.value) })}
                  min="1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Repos</label>
                <button
                  type="button"
                  className="form-input rest-picker-trigger"
                  onClick={() => setShowRestPicker(true)}
                >
                  ⏱ {formatRestTime(newExercise.rest_time || 0)}
                </button>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleAddExercise}>
                {editingIndex !== null ? '✔ Mettre à jour' : '+ Ajouter'} l'exercice
              </button>
              {editingIndex !== null && (
                <button type="button" className="btn btn-outline" onClick={handleCancelEdit}>
                  Annuler
                </button>
              )}
            </div>
          </div>

          {formData.exercises.length > 0 && (
            <div className="card mb-2">
              <h3 className="card-title mb-2">Exercices ({formData.exercises.length})</h3>
              <p className="text-secondary mb-2" style={{ fontSize: '0.875rem' }}>
                Glissez-déposez pour réorganiser
              </p>

              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="exercises">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef}>
                      {formData.exercises.map((exercise, index) => {
                        // Calcul des bornes du superset auquel appartient l'exo
                        // (pour décorer la première / dernière card du groupe)
                        const sg = exercise.superset_group ?? null;
                        const prevSg = index > 0 ? (formData.exercises[index - 1].superset_group ?? null) : null;
                        const nextSg = index < formData.exercises.length - 1 ? (formData.exercises[index + 1].superset_group ?? null) : null;
                        const isInSuperset = sg !== null && (prevSg === sg || nextSg === sg);
                        const isFirstOfSuperset = isInSuperset && prevSg !== sg;
                        const isLastOfSuperset  = isInSuperset && nextSg !== sg;
                        // Position alphabétique de l'exo DANS son superset (A, B, C…)
                        let positionInSuperset = 0;
                        if (isInSuperset) {
                          for (let i = index - 1; i >= 0; i -= 1) {
                            if ((formData.exercises[i].superset_group ?? null) !== sg) break;
                            positionInSuperset += 1;
                          }
                        }
                        // Taille du groupe (pour l'en-tête)
                        let groupSize = 1;
                        if (isFirstOfSuperset) {
                          for (let i = index + 1; i < formData.exercises.length; i += 1) {
                            if ((formData.exercises[i].superset_group ?? null) !== sg) break;
                            groupSize += 1;
                          }
                        }

                        const canLinkWithNext = index < formData.exercises.length - 1
                          && (nextSg !== sg || sg === null);
                        const isLinkedToNext = isInSuperset && nextSg === sg;

                        return (
                          <React.Fragment key={index}>
                            {isFirstOfSuperset && (
                              <div className="superset-header">
                                <span className="superset-header-icon">🔗</span>
                                <span className="superset-header-label">Superset · {groupSize} exercices</span>
                              </div>
                            )}
                            <Draggable draggableId={`exercise-${index}`} index={index}>
                              {(provided) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`exercise-item${isInSuperset ? ' exercise-item--in-superset' : ''}${isFirstOfSuperset ? ' exercise-item--superset-first' : ''}${isLastOfSuperset ? ' exercise-item--superset-last' : ''}`}
                                >
                                  <div className="exercise-grip">☰</div>
                                  {isInSuperset && (
                                    <div className="exercise-superset-letter" title="Position dans le superset">
                                      {supersetLetter(positionInSuperset)}
                                    </div>
                                  )}
                                  <div className="exercise-info">
                                    <strong>{exercise.name}</strong>
                                    <span className="text-secondary">
                                      {exercise.sets} séries × {exercise.reps_min}
                                      {exercise.reps_max !== exercise.reps_min && `-${exercise.reps_max}`} reps
                                      • {exercise.rest_time}s repos
                                    </span>
                                  </div>
                                  <div className="exercise-actions">
                                    {/* Lier / Délier */}
                                    {isInSuperset ? (
                                      <button
                                        type="button"
                                        className="btn-icon btn-icon--unlink"
                                        onClick={() => handleUnlink(index)}
                                        title="Retirer du superset"
                                        aria-label="Retirer du superset"
                                      >
                                        🔓
                                      </button>
                                    ) : canLinkWithNext ? (
                                      <button
                                        type="button"
                                        className="btn-icon btn-icon--link"
                                        onClick={() => handleLinkNext(index)}
                                        title="Lier en superset avec l'exercice suivant"
                                        aria-label="Lier en superset avec l'exercice suivant"
                                      >
                                        🔗
                                      </button>
                                    ) : null}
                                    {/* Quand l'exo est en milieu/début de superset, exposer aussi
                                        le bouton "lier au suivant" si le suivant n'est pas déjà dans
                                        le même groupe (cas où on étend un groupe existant). */}
                                    {isInSuperset && !isLinkedToNext && index < formData.exercises.length - 1 && (
                                      <button
                                        type="button"
                                        className="btn-icon btn-icon--link"
                                        onClick={() => handleLinkNext(index)}
                                        title="Inclure aussi l'exercice suivant"
                                        aria-label="Inclure aussi l'exercice suivant"
                                      >
                                        🔗
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-small"
                                      onClick={() => handleEditExercise(index)}
                                      title="Modifier cet exercice"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-small"
                                      onClick={() => handleRemoveExercise(index)}
                                      title="Supprimer cet exercice"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                            {/* Connecteur visuel "↻" entre deux exos d'un même superset */}
                            {isInSuperset && nextSg === sg && (
                              <div className="superset-connector" aria-hidden="true">↻ enchaîner</div>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {!user ? 'Se connecter pour enregistrer' : (loading ? 'Enregistrement...' : 'Enregistrer la séance')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/sessions')}
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {showRestPicker && (
        <RestTimePicker
          value={newExercise.rest_time || 0}
          onChange={(v) => setNewExercise({ ...newExercise, rest_time: v })}
          onClose={() => setShowRestPicker(false)}
        />
      )}
    </div>
  );
};

export default CreateSession;