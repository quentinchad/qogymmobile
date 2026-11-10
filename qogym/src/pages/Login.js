import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService, sessionService } from '../services/api';
import AndroidAppLink from '../components/AndroidAppLink';
import './Auth.css';

const Login = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleResend = async () => {
    if (!email) return;
    setResendLoading(true);
    setResendMessage('');
    try {
      await authService.resendVerification(email);
      setResendMessage('Email renvoyé !');
    } catch (err) {
      setResendMessage(err.response?.data?.error || "Erreur lors de l'envoi");
    } finally {
      setResendLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNeedsVerification(false);
    setResendMessage('');
    setLoading(true);

    try {
      const response = await authService.login(email, password);
      
      if (response.data.success) {
        const { user, token } = response.data;
        onLogin(user, token);

        const pendingSession = localStorage.getItem('qogym_pending_session');

        if (pendingSession) {
          try {
            const sessionData = JSON.parse(pendingSession);
            await sessionService.create(sessionData);
            localStorage.removeItem('qogym_pending_session');
            localStorage.removeItem('qogym_redirect_after_login');
            navigate('/sessions');
            return;
          } catch (err) {
            console.error('Erreur création séance après login', err);
            setError("La séance n'a pas pu être enregistrée");
            return;
          }
        }

        const redirectPath = localStorage.getItem('qogym_redirect_after_login');
        if (redirectPath) {
          localStorage.removeItem('qogym_redirect_after_login');
          navigate(redirectPath);
        } else {
          navigate('/feed');
        }
      }
    } catch (err) {
      if (err.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
      }
      setError(err.response?.data?.error || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">QoGym</h1>
          <p className="auth-subtitle">Connectez-vous à votre compte</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="form-error">{error}</div>}
          {needsVerification && (
            <div className="form-group" style={{ marginTop: -8, marginBottom: 15 }}>
              {resendMessage && <div className="form-success" style={{ marginBottom: 10 }}>{resendMessage}</div>}
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={handleResend}
                disabled={resendLoading}
              >
                {resendLoading ? 'Envoi...' : "Renvoyer l'email de confirmation"}
              </button>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <div className="form-group" style={{ textAlign: 'right', marginTop: '-10px', marginBottom: '15px' }}>
            <Link to="/forgot-password" className="auth-link" style={{ fontSize: '14px' }}>
              Mot de passe oublié ?
            </Link>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Pas encore de compte ?{' '}
            <Link to="/register" className="auth-link">
              S'inscrire
            </Link>
          </p>
        </div>

        {/* Téléchargement APK Android : ne s'affiche que sur appareil Android */}
        <AndroidAppLink variant="auth" />
      </div>
    </div>
  );
};

export default Login;