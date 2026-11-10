import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/api';
import './ChangePassword.css';

const ChangePassword = ({ user }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validations
    if (!formData.currentPassword || !formData.newPassword || !formData.confirmPassword) {
      setError('Tous les champs sont requis');
      return;
    }

    if (formData.newPassword.length < 6) {
      setError('Le nouveau mot de passe doit contenir au moins 6 caractères');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Les nouveaux mots de passe ne correspondent pas');
      return;
    }

    if (formData.currentPassword === formData.newPassword) {
      setError('Le nouveau mot de passe doit être différent de l\'ancien');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.changePassword(
        formData.currentPassword,
        formData.newPassword
      );

      setSuccess('Mot de passe modifié avec succès ! Redirection...');
      
      // Rediriger vers le profil après 2 secondes
      setTimeout(() => {
        navigate('/profile');
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la modification du mot de passe');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <button className="btn btn-outline" onClick={() => navigate('/profile')}>
          ← Retour
        </button>
        <h1 className="page-title">Modifier le mot de passe</h1>
      </div>

      <div className="card" style={{ maxWidth: '500px', margin: '0 auto' }}>
        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

          <div className="form-group">
            <label className="form-label">Mot de passe actuel</label>
            <input
              type="password"
              name="currentPassword"
              className="form-input"
              value={formData.currentPassword}
              onChange={handleChange}
              placeholder="Votre mot de passe actuel"
              required
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Nouveau mot de passe</label>
            <input
              type="password"
              name="newPassword"
              className="form-input"
              value={formData.newPassword}
              onChange={handleChange}
              placeholder="Au moins 6 caractères"
              required
              autoComplete="new-password"
              disabled={loading}
            />
            <small className="text-secondary">Minimum 6 caractères</small>
          </div>

          <div className="form-group">
            <label className="form-label">Confirmer le nouveau mot de passe</label>
            <input
              type="password"
              name="confirmPassword"
              className="form-input"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Répétez le nouveau mot de passe"
              required
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Modification en cours...' : '🔒 Modifier le mot de passe'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/profile')}
              disabled={loading}
            >
              Annuler
            </button>
          </div>
        </form>

        <div className="security-info">
          <h4>💡 Conseils de sécurité</h4>
          <ul>
            <li>Utilisez un mot de passe unique et fort</li>
            <li>Ne partagez jamais votre mot de passe</li>
            <li>Changez-le régulièrement</li>
            <li>Vous recevrez un email de confirmation</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ChangePassword;