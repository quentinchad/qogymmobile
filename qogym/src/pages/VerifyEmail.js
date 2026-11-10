import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService, sessionService } from '../services/api';
import './Auth.css';

/**
 * Page ouverte depuis le lien envoyé par email après l'inscription
 * (https://qojim.com/verify-email?token=...). Valide le token côté API,
 * puis connecte automatiquement l'utilisateur si tout est ok.
 */
const VerifyEmail = ({ onLogin }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('loading'); // loading | success | error
  const [error, setError] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    if (!token) {
      setStatus('error');
      setError('Lien de confirmation invalide');
      return;
    }

    (async () => {
      try {
        const response = await authService.verifyEmail(token);
        if (response.data.success) {
          const { user, token: sessionToken } = response.data;
          onLogin(user, sessionToken);
          setStatus('success');

          // Si une séance avait été créée avant inscription (cf.
          // CreateSession.js), on la sauvegarde maintenant que le compte
          // est enfin actif — même logique que dans Login.js.
          const pendingSession = localStorage.getItem('qogym_pending_session');
          if (pendingSession) {
            try {
              const sessionData = JSON.parse(pendingSession);
              await sessionService.create(sessionData);
              localStorage.removeItem('qogym_pending_session');
              localStorage.removeItem('qogym_redirect_after_login');
              setTimeout(() => navigate('/sessions'), 1500);
              return;
            } catch (err) {
              console.error('Erreur création séance après confirmation email', err);
              // Le compte est bien confirmé, seule la séance a échoué :
              // on n'affiche pas ça comme une erreur de confirmation.
              setTimeout(() => navigate('/create-session'), 1500);
              return;
            }
          }

          setTimeout(() => navigate('/feed'), 1500);
        }
      } catch (err) {
        setStatus('error');
        setError(err.response?.data?.error || 'Erreur lors de la confirmation');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResendLoading(true);
    setResendMessage('');
    try {
      await authService.resendVerification(resendEmail);
      setResendMessage('Un nouvel email a été envoyé.');
    } catch (err) {
      setResendMessage(err.response?.data?.error || "Erreur lors de l'envoi");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">QoGym</h1>
          <p className="auth-subtitle">Confirmation de l'email</p>
        </div>

        {status === 'loading' && <p>Vérification en cours...</p>}

        {status === 'success' && (
          <div className="form-success">
            Ton email est confirmé, ton compte est actif ! Redirection...
          </div>
        )}

        {status === 'error' && (
          <>
            <div className="form-error">{error}</div>
            <div className="form-group" style={{ marginTop: 20 }}>
              <label className="form-label">Recevoir un nouveau lien</label>
              <input
                type="email"
                className="form-input"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                placeholder="votre@email.com"
              />
            </div>
            {resendMessage && <div className="form-success">{resendMessage}</div>}
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleResend}
              disabled={resendLoading || !resendEmail}
            >
              {resendLoading ? 'Envoi...' : "Renvoyer l'email de confirmation"}
            </button>
            <div className="auth-footer">
              <p>
                <Link to="/login" className="auth-link">← Retour à la connexion</Link>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
