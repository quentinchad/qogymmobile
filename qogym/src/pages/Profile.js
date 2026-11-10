import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { workoutService, preferencesService, monthlyReportService, authService } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '../components/Toast';
import WorkoutDetailModal from '../components/WorkoutDetailModal';
import StepsSection from '../components/StepsSection';
import AndroidAppLink from '../components/AndroidAppLink';
import './Profile.css';

const Profile = ({ user, onLogout, onUserUpdate }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  // Pagination de l'historique : on charge un premier batch puis l'utilisateur
  // peut demander d'autres pages via le bouton "Charger plus".
  const HISTORY_PAGE_SIZE = 10;
  const [historyHasMore, setHistoryHasMore]       = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  // Modale détail d'un entraînement (ouverte au clic sur une card)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [defaultWorkoutPrivacy, setDefaultWorkoutPrivacy] = useState('public');
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState(null);

  // Objectif calorique quotidien (Nutrition — admin uniquement pour le moment)
  const [kcalTarget, setKcalTarget]     = useState('');
  const [kcalTargetSaving, setKcalTargetSaving] = useState(false);
  // Objectifs macros (protéines / glucides / lipides) — pareil, NULL/vide
  // si pas d'objectif. Stockés en string pour conserver l'input utilisateur
  // tel quel pendant l'édition (compatible avec controlled input number).
  const [proteinTarget, setProteinTarget] = useState('');
  const [carbsTarget,   setCarbsTarget]   = useState('');
  const [fatTarget,     setFatTarget]     = useState('');
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState(null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(null);
  const [userPdp, setUserPdp] = useState(user?.pdp || null);

  const [monthlyReports, setMonthlyReports] = useState([]);

  // Édition du username : state local pour l'input + savedness flag
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft]     = useState(user?.username || '');
  const [usernameSaving, setUsernameSaving]   = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsResponse, historyResponse, preferencesResponse, reportsResponse] = await Promise.all([
        workoutService.getStats(),
        workoutService.getHistory(HISTORY_PAGE_SIZE, 0),
        preferencesService.getPreferences(),
        monthlyReportService.getList().catch(() => ({ data: { reports: [] } })),
      ]);
      
      setStats(statsResponse.data.stats);
      setHistory(historyResponse.data.history);
      setHistoryHasMore(!!historyResponse.data.has_more);
      if (preferencesResponse.data.preferences) {
        setDefaultWorkoutPrivacy(preferencesResponse.data.preferences.default_workout_privacy || 'public');
        setUserPdp(preferencesResponse.data.preferences.pdp || null);
        const prefs = preferencesResponse.data.preferences;
        const t = prefs.daily_kcal_target;
        setKcalTarget(t ? String(t) : '');
        // Objectifs macros : on convertit en chaîne pour l'input contrôlé,
        // valeur vide si NULL.
        setProteinTarget(prefs.daily_protein_target != null ? String(prefs.daily_protein_target) : '');
        setCarbsTarget(  prefs.daily_carbs_target   != null ? String(prefs.daily_carbs_target)   : '');
        setFatTarget(    prefs.daily_fat_target     != null ? String(prefs.daily_fat_target)     : '');
      }
      setMonthlyReports(reportsResponse.data.reports || []);
    } catch (err) {
      console.error('Erreur lors du chargement des données', err);
    } finally {
      setLoading(false);
    }
  };

  // Charge la page suivante de l'historique. On envoie offset = nombre
  // d'entrées déjà affichées et on append le résultat à la liste existante.
  const loadMoreHistory = async () => {
    if (historyLoadingMore || !historyHasMore) return;
    setHistoryLoadingMore(true);
    try {
      const res = await workoutService.getHistory(HISTORY_PAGE_SIZE, history.length);
      const more = res.data?.history || [];
      // Filtre défensif anti-doublons (si suppression d'un workout entre-temps
      // la pagination peut avoir bougé).
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

  const handleSaveUsername = async () => {
    const trimmed = usernameDraft.trim();
    if (!trimmed) return;
    if (trimmed === user.username) {
      setEditingUsername(false);
      return;
    }
    setUsernameSaving(true);
    try {
      const res = await authService.changeUsername(trimmed);
      const newUsername = res.data?.username || trimmed;
      onUserUpdate && onUserUpdate({ username: newUsername });
      setEditingUsername(false);
      showToast('Nom d\'utilisateur mis à jour', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la mise à jour';
      showToast(msg, 'error');
    } finally {
      setUsernameSaving(false);
    }
  };

  const handleCancelUsername = () => {
    setUsernameDraft(user.username);
    setEditingUsername(false);
  };

  // Sauvegarde l'objectif kcal + les 3 objectifs macros en une seule requête
  // PUT (le backend supporte la mise à jour partielle, on envoie les 4
  // toujours pour rester simples). NULL = retirer l'objectif sur ce champ.
  const handleSaveKcalTarget = async () => {
    setKcalTargetSaving(true);
    try {
      // Helper : "" → null, sinon parseFloat avec garde-fou
      const parseTarget = (raw, kind /* 'int' | 'float' */) => {
        const trimmed = String(raw).trim();
        if (trimmed === '') return null;
        const n = kind === 'int' ? parseInt(trimmed, 10) : parseFloat(trimmed);
        if (!Number.isFinite(n) || n < 0) return NaN; // sentinelle "invalide"
        return n;
      };

      const kcalVal    = parseTarget(kcalTarget,    'int');
      const proteinVal = parseTarget(proteinTarget, 'float');
      const carbsVal   = parseTarget(carbsTarget,   'float');
      const fatVal     = parseTarget(fatTarget,     'float');

      if ([kcalVal, proteinVal, carbsVal, fatVal].some(v => Number.isNaN(v))) {
        showToast('Un objectif est invalide', 'error');
        setKcalTargetSaving(false);
        return;
      }

      await preferencesService.updatePreferences({
        daily_kcal_target:    kcalVal,
        daily_protein_target: proteinVal,
        daily_carbs_target:   carbsVal,
        daily_fat_target:     fatVal,
      });
      showToast('Objectifs enregistrés', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur', 'error');
    } finally {
      setKcalTargetSaving(false);
    }
  };

  const handlePrivacyChange = async (newPrivacy) => {
    setDefaultWorkoutPrivacy(newPrivacy);
    setPrivacySaving(true);
    setPrivacyMessage(null);

    try {
      const response = await preferencesService.updatePreferences({ default_workout_privacy: newPrivacy });
      setPrivacyMessage({
        type: 'success',
        text: 'Préférences enregistrées avec succès !'
      });
      setTimeout(() => setPrivacyMessage(null), 5000);
    } catch (err) {
      setDefaultWorkoutPrivacy(defaultWorkoutPrivacy);
      setPrivacyMessage({
        type: 'error',
        text: 'Erreur lors de l\'enregistrement des préférences'
      });
      console.error('Erreur:', err);
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleDeleteWorkout = async (workoutId) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cet entraînement ?')) {
      return;
    }

    try {
      await workoutService.delete(workoutId);
      setHistory(history.filter(w => w.id !== workoutId));
      const statsResponse = await workoutService.getStats();
      setStats(statsResponse.data.stats);
    } catch (err) {
      console.error('Erreur lors de la suppression', err);
      alert('Erreur lors de la suppression de l\'entraînement');
    }
  };

  const handleProfilePictureSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfilePicture(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePicturePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProfilePictureUpload = async () => {
    if (!profilePicture) return;

    setUploadingPicture(true);
    setUploadMessage(null);

    try {
      const response = await preferencesService.uploadProfilePicture(profilePicture);
      setUploadMessage({
        type: 'success',
        text: 'Photo de profil mise à jour avec succès !'
      });
      setProfilePicture(null);
      setProfilePicturePreview(null);
      loadData();
      setTimeout(() => setUploadMessage(null), 5000);
    } catch (err) {
      setUploadMessage({
        type: 'error',
        text: err.response?.data?.error || 'Erreur lors de l\'upload'
      });
      console.error('Erreur:', err);
    } finally {
      setUploadingPicture(false);
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

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Mon Profil</h1>
        <button className="btn btn-danger" onClick={onLogout}>
          Déconnexion
        </button>
      </div>

      {/* Informations utilisateur */}
      <div className="card mb-2">
        <h3 className="card-title">Informations</h3>
        <div className="profile-info">
          {editingUsername ? (
            // Mode édition : on sort du layout flex side-by-side pour avoir
            // un vrai bloc plein largeur — beaucoup plus lisible sur mobile.
            <div className="info-row info-row--editing">
              <label className="username-edit-label" htmlFor="username-input">
                Nom d'utilisateur
              </label>
              <input
                id="username-input"
                type="text"
                className="username-edit-input"
                value={usernameDraft}
                onChange={(e) => setUsernameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')  handleSaveUsername();
                  if (e.key === 'Escape') handleCancelUsername();
                }}
                maxLength={30}
                autoFocus
                disabled={usernameSaving}
                placeholder="3 à 30 caractères"
              />
              <small className="username-edit-hint">
                Lettres, chiffres, tirets, underscores et points autorisés.
              </small>
              <div className="username-edit-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={handleCancelUsername}
                  disabled={usernameSaving}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={handleSaveUsername}
                  disabled={usernameSaving || !usernameDraft.trim() || usernameDraft.trim() === user.username}
                >
                  {usernameSaving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          ) : (
            <div className="info-row">
              <span className="info-label">Nom d'utilisateur</span>
              <span className="info-value-with-action">
                <span className="info-value">{user.username}</span>
                <button
                  type="button"
                  className="info-edit-link"
                  onClick={() => { setUsernameDraft(user.username); setEditingUsername(true); }}
                >
                  Modifier
                </button>
              </span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">Email:</span>
            <span className="info-value">{user.email}</span>
          </div>
          {user.is_admin && (
            <div className="info-row">
              <span className="badge badge-info">Administrateur</span>
            </div>
          )}
          <div className="info-row profile-actions-row" style={{ marginTop: '15px' }}>
            <button
              className="btn btn-outline"
              onClick={() => navigate('/change-password')}
            >
              🔒 Modifier le mot de passe
            </button>
            <button
              className="btn btn-outline"
              onClick={() => navigate(`/exercises/${user.id}`)}
            >
              📚 Mes exercices
            </button>
          </div>
        </div>
      </div>

      {/* Photo de profil */}
      <div className="card mb-2">
        <h3 className="card-title">📷 Photo de profil</h3>
        <div className="profile-picture-section">
          <div className="profile-picture-display">
            {profilePicturePreview ? (
              <img src={profilePicturePreview} alt="Aperçu" className="profile-picture-preview" />
            ) : userPdp ? (
              <img src={`https://qojim.com/pdp/${userPdp}`} alt="Photo de profil" className="profile-picture-preview" />
            ) : (
              <div className="profile-picture-placeholder">
                <span>Pas de photo</span>
              </div>
            )}
          </div>
          
          <div className="profile-picture-upload">
            {uploadMessage && (
              <div className={`message message-${uploadMessage.type}`}>
                {uploadMessage.text}
              </div>
            )}
            
            <label className="file-input-label">
              <input
                type="file"
                accept="image/*"
                onChange={handleProfilePictureSelect}
                disabled={uploadingPicture}
                style={{ display: 'none' }}
              />
              <span className="btn btn-outline">📁 Choisir une photo</span>
            </label>
            
            {profilePicture && (
              <button
                className="btn btn-primary"
                onClick={handleProfilePictureUpload}
                disabled={uploadingPicture}
              >
                {uploadingPicture ? 'Upload en cours...' : '✓ Confirmer'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Rapports mensuels */}
      <div className="card mb-2">
        <h3 className="card-title">📊 Rapports mensuels</h3>
        {monthlyReports.length === 0 ? (
          <p className="card-description">
            Aucun rapport pour le moment. Les rapports sont générés au début de chaque mois.
          </p>
        ) : (
          <ul className="monthly-reports-list">
            {monthlyReports.map((r) => {
              const monthName = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'][r.month];
              return (
                <li key={`${r.year}-${r.month}`} className="monthly-report-item">
                  <button
                    type="button"
                    className="monthly-report-link"
                    onClick={() => navigate(`/monthly-report/${r.year}/${r.month}`)}
                  >
                    <span className="monthly-report-period">{monthName} {r.year}</span>
                    {!r.viewed && <span className="monthly-report-badge">Nouveau</span>}
                    <span className="monthly-report-arrow">→</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Préférences de confidentialité */}
      <div className="card mb-2">
        <h3 className="card-title">🔒 Confidentialité des entraînements</h3>
        <p className="card-description">
          Choisissez si vos entraînements terminés doivent être visibles par vos amis dans le feed.
        </p>
        
        {privacyMessage && (
          <div className={`message message-${privacyMessage.type}`}>
            {privacyMessage.text}
          </div>
        )}

        <div className="privacy-options">
          <label className={`privacy-option ${defaultWorkoutPrivacy === 'public' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="privacy"
              value="public"
              checked={defaultWorkoutPrivacy === 'public'}
              onChange={(e) => handlePrivacyChange(e.target.value)}
              disabled={privacySaving}
            />
            <div className="privacy-option-content">
              <div className="privacy-option-title">🌍 Public</div>
              <div className="privacy-option-desc">Vos amis voient vos entraînements dans le feed</div>
            </div>
          </label>

          <label className={`privacy-option ${defaultWorkoutPrivacy === 'private' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="privacy"
              value="private"
              checked={defaultWorkoutPrivacy === 'private'}
              onChange={(e) => handlePrivacyChange(e.target.value)}
              disabled={privacySaving}
            />
            <div className="privacy-option-content">
              <div className="privacy-option-title">🔒 Privé</div>
              <div className="privacy-option-desc">Personne ne voit vos entraînements (sauf vous)</div>
            </div>
          </label>
        </div>
      </div>

      {/* Objectifs nutrition (kcal + macros) — disponible pour tous les utilisateurs */}
      <div className="card mb-2">
        <h3 className="card-title">🍎 Objectifs nutrition</h3>
        <p className="card-description">
          Définis tes objectifs quotidiens. Laisse vide pour ne pas afficher de progression sur cette ligne.
        </p>
        <div className="targets-grid">
          <div className="kcal-target-row">
            <label className="target-label">Calories</label>
            <input
              type="number"
              inputMode="numeric"
              min="0" max="99999" step="1"
              className="kcal-target-input"
              value={kcalTarget}
              onChange={(e) => setKcalTarget(e.target.value)}
              placeholder="Ex. 2200"
              disabled={kcalTargetSaving}
            />
            <span className="kcal-target-unit">kcal</span>
          </div>
          <div className="kcal-target-row">
            <label className="target-label">Protéines</label>
            <input
              type="number"
              inputMode="decimal"
              min="0" max="9999" step="1"
              className="kcal-target-input"
              value={proteinTarget}
              onChange={(e) => setProteinTarget(e.target.value)}
              placeholder="Ex. 150"
              disabled={kcalTargetSaving}
            />
            <span className="kcal-target-unit">g</span>
          </div>
          <div className="kcal-target-row">
            <label className="target-label">Glucides</label>
            <input
              type="number"
              inputMode="decimal"
              min="0" max="9999" step="1"
              className="kcal-target-input"
              value={carbsTarget}
              onChange={(e) => setCarbsTarget(e.target.value)}
              placeholder="Ex. 250"
              disabled={kcalTargetSaving}
            />
            <span className="kcal-target-unit">g</span>
          </div>
          <div className="kcal-target-row">
            <label className="target-label">Lipides</label>
            <input
              type="number"
              inputMode="decimal"
              min="0" max="9999" step="1"
              className="kcal-target-input"
              value={fatTarget}
              onChange={(e) => setFatTarget(e.target.value)}
              placeholder="Ex. 70"
              disabled={kcalTargetSaving}
            />
            <span className="kcal-target-unit">g</span>
          </div>
        </div>
        <div className="targets-save-row">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={handleSaveKcalTarget}
            disabled={kcalTargetSaving}
          >
            {kcalTargetSaving ? '…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* Pas quotidiens : objectif + historique + graphique */}
      <StepsSection />

      {/* Statistiques */}
      {stats && (
        <div className="card mb-2">
          <h3 className="card-title mb-2">Statistiques</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.total_workouts || 0}</div>
              <div className="stat-label">Entraînements</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_days || 0}</div>
              <div className="stat-label">Jours d'activité</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_sets || 0}</div>
              <div className="stat-label">Séries totales</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_reps || 0}</div>
              <div className="stat-label">Répétitions</div>
            </div>
          </div>
        </div>
      )}

      {/* Historique */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="card-title mb-2">Derniers entraînements</h3>
          <div className="history-list">
            {history.map((workout) => (
              <div
                key={workout.id}
                className="history-item history-item--clickable"
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
                <div className="history-info">
                  <strong>{workout.session_name}</strong>
                  <span className="text-secondary">
                    {new Date(workout.completed_at).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className="history-stats">
                  <span className="badge badge-info">{workout.total_sets} séries</span>
                  <button
                    className="btn btn-danger btn-small"
                    onClick={(e) => {
                      // Empêche l'ouverture de la modale au clic sur 🗑️
                      e.stopPropagation();
                      handleDeleteWorkout(workout.id);
                    }}
                    title="Supprimer l'entraînement"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Bouton "Charger plus" — visible uniquement s'il reste des
              entraînements à charger après le batch courant. */}
          {historyHasMore && (
            <div className="history-load-more">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={loadMoreHistory}
                disabled={historyLoadingMore}
              >
                {historyLoadingMore ? 'Chargement…' : `Charger ${HISTORY_PAGE_SIZE} entraînements de plus`}
              </button>
            </div>
          )}
        </div>
      )}

      {history.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p className="empty-state-text">
            Aucun entraînement terminé pour le moment.<br />
            Commencez dès maintenant !
          </p>
        </div>
      )}

      {/* Téléchargement APK Android : carte affichée uniquement si l'user
          est sur un appareil Android (sur navigateur — la WebView de l'app
          native est exclue par AndroidAppLink elle-même). */}
      <AndroidAppLink variant="card" />

      {/* Modale détail d'un entraînement — partagée avec UserProfile et Feed */}
      <WorkoutDetailModal
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
        currentUserId={user?.id}
      />
    </div>
  );
};

export default Profile;