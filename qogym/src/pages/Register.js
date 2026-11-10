import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './Auth.css';
import { authService } from '../services/api';
import AndroidAppLink from '../components/AndroidAppLink';


const Register = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (formData.password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.register(
        formData.email,
        formData.username,
        formData.password
      );

      if (response.data.success) {
        // Le compte n'est pas encore utilisable : il faut confirmer l'email
        // avant de pouvoir se connecter (cf. auth.php / verifyAuth()).
        // On ne connecte donc pas automatiquement l'utilisateur ici.
        setRegisteredEmail(response.data.email || formData.email);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'inscription');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!registeredEmail) return;
    setResendLoading(true);
    setResendMessage('');
    try {
      await authService.resendVerification(registeredEmail);
      setResendMessage('Email renvoyé !');
    } catch (err) {
      setResendMessage(err.response?.data?.error || "Erreur lors de l'envoi");
    } finally {
      setResendLoading(false);
    }
  };

  if (registeredEmail) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title">QoGym</h1>
            <p className="auth-subtitle">Vérifie ta boîte mail</p>
          </div>
          <div className="form-success" style={{ marginBottom: 20 }}>
            Un email de confirmation a été envoyé à <strong>{registeredEmail}</strong>.
            Clique sur le lien qu'il contient pour activer ton compte (valable 24h).
          </div>
          {resendMessage && <div className="form-success">{resendMessage}</div>}
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={handleResend}
            disabled={resendLoading}
          >
            {resendLoading ? 'Envoi...' : "Je n'ai rien reçu, renvoyer l'email"}
          </button>
          <div className="auth-footer">
            <p>
              <Link to="/login" className="auth-link">← Retour à la connexion</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">QoGym</h1>
          <p className="auth-subtitle">Créez votre compte</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label className="form-label">Nom d'utilisateur</label>
            <input
              type="text"
              name="username"
              className="form-input"
              value={formData.username}
              onChange={handleChange}
              placeholder="votrepseudo"
              required
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              name="email"
              className="form-input"
              value={formData.email}
              onChange={handleChange}
              placeholder="votre@email.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <input
              type="password"
              name="password"
              className="form-input"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirmer le mot de passe</label>
            <input
              type="password"
              name="confirmPassword"
              className="form-input"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Inscription...' : 'S\'inscrire'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Déjà un compte ?{' '}
            <Link to="/login" className="auth-link">
              Se connecter
            </Link>
          </p>
        </div>

        {/* Téléchargement APK Android : ne s'affiche que sur appareil Android */}
        <AndroidAppLink variant="auth" />
      </div>
    </div>
  );
};

export default Register;