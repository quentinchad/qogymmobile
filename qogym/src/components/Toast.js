import React, { useEffect, useState, useCallback, useContext, createContext } from 'react';
import ReactDOM from 'react-dom';
import './Toast.css';

/**
 * Toast — message éphémère stylé qui remplace `alert()`.
 *
 * Architecture : un seul Provider à la racine de l'app expose un Context
 * avec la fonction `showToast`. N'importe quel composant descendant peut
 * appeler `useToast().showToast(...)` sans avoir à monter de container —
 * le container vit dans le Provider, ce qui rend les toasts résistants
 * aux démontages de page (utile pour afficher un toast juste avant un
 * `navigate(...)`).
 *
 *   // Dans App.js :
 *   <ToastProvider>
 *     <Routes>...</Routes>
 *   </ToastProvider>
 *
 *   // Dans n'importe quel composant :
 *   const { showToast } = useToast();
 *   showToast('Entraînement enregistré !', 'success');
 *
 * Variants :
 *   - 'success' (vert, défaut) : confirmation
 *   - 'error'   (rouge)        : erreur
 *   - 'info'    (gris)         : info neutre
 */

const ToastContext = createContext({ showToast: () => {} });

const Toast = ({ id, message, variant = 'success', duration = 3000, onDismiss }) => {
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onDismiss(id), 200);
  }, [id, leaving, onDismiss]);

  useEffect(() => {
    if (duration === 0) return;
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
  }, [duration, dismiss]);

  const icon = variant === 'success' ? '✓'
             : variant === 'error'   ? '!'
             : 'i';

  return (
    <div
      className={`toast toast--${variant}${leaving ? ' toast--leaving' : ''}`}
      onClick={dismiss}
      role="status"
    >
      <div className="toast-icon">{icon}</div>
      <div className="toast-message">{message}</div>
    </div>
  );
};

/**
 * Provider à monter à la racine de l'app. Maintient l'état des toasts
 * et rend le container via portail sur document.body.
 */
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, variant = 'success', duration = 3000) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, message, variant, duration }]);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && ReactDOM.createPortal(
        <div className="toast-stack">
          {toasts.map(t => (
            <Toast
              key={t.id}
              id={t.id}
              message={t.message}
              variant={t.variant}
              duration={t.duration}
              onDismiss={dismiss}
            />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};

/**
 * Hook pour afficher un toast depuis n'importe où dans l'app.
 * Nécessite un <ToastProvider> ancêtre.
 */
export const useToast = () => useContext(ToastContext);

export default Toast;