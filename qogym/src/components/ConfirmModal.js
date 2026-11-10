import React, { useState, useCallback, useRef, useContext, createContext } from 'react';
import ReactDOM from 'react-dom';
import './ConfirmModal.css';

/**
 * Modale de confirmation stylée — remplace `window.confirm`.
 *
 * Architecture en Provider/Context comme Toast : un seul `<ConfirmProvider>`
 * à la racine, et `useConfirm()` dans n'importe quel composant. La modale
 * survit aux démontages de pages.
 *
 *   // App.js :
 *   <ConfirmProvider>
 *     <Routes>...</Routes>
 *   </ConfirmProvider>
 *
 *   // Composant :
 *   const { confirm } = useConfirm();
 *   const ok = await confirm({
 *     title: "Terminer l'entraînement ?",
 *     message: "Tes performances seront enregistrées.",
 *     confirmLabel: "Terminer",
 *     cancelLabel: "Continuer",
 *     variant: "primary",  // "primary" | "danger"
 *   });
 */

const ConfirmContext = createContext({ confirm: async () => false });

const ConfirmModal = ({
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel  = 'Annuler',
  variant = 'primary',
  onAnswer,
}) => {
  const [leaving, setLeaving] = useState(false);

  const close = (answer) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onAnswer(answer), 180);
  };

  return (
    <div
      className={`confirm-overlay${leaving ? ' confirm-overlay--leaving' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) close(false); }}
    >
      <div className="confirm-modal" data-no-swipe role="dialog" aria-modal="true">
        {title && <div className="confirm-title">{title}</div>}
        {message && <div className="confirm-message">{message}</div>}
        <div className="confirm-actions">
          <button
            type="button"
            className="confirm-btn confirm-btn--ghost"
            onClick={() => close(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-btn confirm-btn--${variant}`}
            onClick={() => close(true)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ConfirmProvider = ({ children }) => {
  const [opts, setOpts] = useState(null);
  const resolverRef = useRef(null);
  // Compteur incrémenté à chaque nouvel appel confirm() — sert de `key`
  // sur la modale interne pour forcer un démontage/remontage propre.
  // Sans ça, deux confirms à la suite réutilisent le même composant et
  // son state interne `leaving=true` du premier reste actif → le bouton
  // du second confirm devient inerte.
  const seqRef = useRef(0);

  const confirm = useCallback((options = {}) => {
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      seqRef.current += 1;
      setOpts({ ...options, _seq: seqRef.current });
    });
  }, []);

  const handleAnswer = useCallback((answer) => {
    if (resolverRef.current) {
      resolverRef.current(answer);
      resolverRef.current = null;
    }
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {opts && ReactDOM.createPortal(
        <ConfirmModal key={opts._seq} {...opts} onAnswer={handleAnswer} />,
        document.body
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => useContext(ConfirmContext);

export default ConfirmModal;