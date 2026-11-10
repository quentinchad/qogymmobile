import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Recharge des données quand une page main du SwipeShell redevient active.
 *
 * Pourquoi ce hook : avec le SwipeShell, les pages principales (Feed,
 * Sessions, Qojim, Profile) ne sont jamais démontées. Du coup leur
 * `useEffect [user]` ne tire qu'une seule fois — au tout premier mount —
 * et les données ne sont jamais rafraîchies après création/modif sur une
 * autre page (ex. retour de /create-session vers /sessions).
 *
 * Ce hook surveille `location.pathname` : à chaque fois qu'il (re)devient
 * `mainPath` après en avoir été différent, on appelle `callback`.
 *
 * Usage :
 *   useRefreshOnFocus('/sessions', () => loadSessions());
 */
export const useRefreshOnFocus = (mainPath, callback) => {
  const location = useLocation();
  const wasOnPage = useRef(location.pathname === mainPath);
  // Garde la dernière version stable du callback sans relancer l'effect.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const isOnPage = location.pathname === mainPath;
    if (isOnPage && !wasOnPage.current) {
      // On revient sur la page → refresh
      cbRef.current && cbRef.current();
    }
    wasOnPage.current = isOnPage;
  }, [location.pathname, mainPath]);
};

export default useRefreshOnFocus;