import React, { useEffect, useRef, useState, useCallback } from 'react';
import { isNativeAppContext } from '../utils/nativeApp';
import './PullToRefresh.css';

/**
 * PullToRefresh
 * ---------------------------------------------------------------------------
 * "Tire vers le bas pour rafraîchir" — comme YouTube / Instagram.
 *
 * Contexte technique IMPORTANT :
 *   - L'app est une WebView. Une WebView n'a PAS de pull-to-refresh natif
 *     ici (le wrapper n'implémente pas de SwipeRefreshLayout) → on le fait
 *     intégralement en JS.
 *   - Le scroll de l'app ne se fait PAS sur `window` : chaque page scrolle
 *     dans son propre conteneur (`.swipe-shell-slide` ou
 *     `.swipe-shell-overlay`, qui ont `overflow-y: auto`). `.swipe-shell`
 *     lui-même est `overflow: hidden`.
 *   - On ne peut donc PAS se contenter de regarder window.scrollY, et
 *     surtout on ne doit PAS appliquer un `transform: translateY` sur un
 *     wrapper englobant : ça créerait un containing-block qui casserait
 *     les `position: fixed` (le `.page-header` notamment).
 *
 * Design retenu :
 *   - Les listeners touch sont posés sur `document` (capture globale).
 *   - On retrouve dynamiquement le scroller actif sous le doigt et on
 *     vérifie qu'il est tout en haut (scrollTop ~ 0).
 *   - On n'anime QU'UN indicateur en `position: fixed` par-dessus l'UI
 *     (aucune transformation du contenu de l'app).
 *   - Au relâchement, si armé → `window.location.reload()` (vrai refresh
 *     navigateur, comme demandé). App.js restaurera la bonne page au boot
 *     via BootRouteRestorer + utils/lastRoute.
 *
 * Hors contexte app (navigateur desktop / Chrome mobile) : le composant
 * est totalement inerte (il rend juste ses enfants).
 */

// Distance (px, après résistance) à atteindre pour armer le refresh.
const TRIGGER_DISTANCE = 70;
// Plafond visuel de la tirette.
const MAX_PULL = 110;
// Coefficient de résistance (plus c'est bas, plus c'est "dur" à tirer).
const RESISTANCE = 0.5;

// Remonte la chaîne des parents pour trouver le premier élément réellement
// scrollable verticalement à partir de la cible du touch.
const findScroller = (start) => {
  let el = start;
  while (el && el.nodeType === 1) {
    const oy = window.getComputedStyle(el).overflowY;
    const scrollable = (oy === 'auto' || oy === 'scroll') &&
      el.scrollHeight > el.clientHeight + 1;
    if (scrollable) return el;
    el = el.parentElement;
  }
  return null;
};

const PullToRefresh = ({ children }) => {
  const enabled = isNativeAppContext();

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const armedRef = useRef(false);
  const scrollerRef = useRef(null);

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback((e) => {
    if (refreshing) return;
    if (e.touches.length !== 1) return;
    const scroller = findScroller(e.target);
    // Scroller pas tout en haut → on laisse le scroll natif, pas de pull.
    if (scroller && scroller.scrollTop > 1) {
      pullingRef.current = false;
      return;
    }
    // Cas page non scrollable : on prend window comme repère.
    if (!scroller && (window.scrollY || window.pageYOffset || 0) > 1) {
      pullingRef.current = false;
      return;
    }
    scrollerRef.current = scroller;
    startYRef.current = e.touches[0].clientY;
    pullingRef.current = true;
    armedRef.current = false;
  }, [refreshing]);

  const onTouchMove = useCallback((e) => {
    if (refreshing || !pullingRef.current) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy <= 0) {
      // Mouvement vers le haut → ce n'est pas un pull.
      pullingRef.current = false;
      setPull(0);
      return;
    }
    // Si le scroller a bougé entre-temps (pas tout en haut), on annule pour
    // ne pas voler un scroll légitime.
    const sc = scrollerRef.current;
    if (sc && sc.scrollTop > 1) {
      pullingRef.current = false;
      setPull(0);
      return;
    }
    const eased = Math.min(MAX_PULL, dy * RESISTANCE);
    armedRef.current = eased >= TRIGGER_DISTANCE;
    setPull(eased);
    // On bloque le rubber-band / scroll natif tant qu'on gère le geste.
    if (e.cancelable) e.preventDefault();
  }, [refreshing]);

  const onTouchEnd = useCallback(() => {
    if (refreshing || !pullingRef.current) return;
    pullingRef.current = false;
    if (armedRef.current) {
      setRefreshing(true);
      setPull(TRIGGER_DISTANCE);
      // Court délai pour laisser voir le spinner "armé" avant le reload,
      // sinon ça flashe et on doute que le refresh ait marché.
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (_) {
          setRefreshing(false);
          setPull(0);
        }
      }, 350);
    } else {
      setPull(0);
    }
  }, [refreshing]);

  useEffect(() => {
    if (!enabled) return;
    // Listeners au niveau document. touchmove en non-passif pour pouvoir
    // preventDefault le scroll natif pendant la tirette.
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, onTouchStart, onTouchMove, onTouchEnd]);

  if (!enabled) return children;

  const progress = Math.min(1, pull / TRIGGER_DISTANCE);

  return (
    <>
      {/* Indicateur en position fixed : NE déplace PAS le contenu de l'app,
          donc aucun risque de casser les position:fixed (page-header). */}
      <div
        className={`ptr-overlay${refreshing ? ' ptr-overlay--refreshing' : ''}`}
        style={{
          height: `${pull}px`,
          opacity: pull > 4 ? 1 : 0,
        }}
        aria-hidden="true"
      >
        <div
          className="ptr-spinner"
          style={{
            transform: refreshing
              ? undefined
              : `rotate(${progress * 300}deg) scale(${0.55 + progress * 0.45})`,
            opacity: 0.4 + progress * 0.6,
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle
              className="ptr-spinner-track"
              cx="12" cy="12" r="9"
              fill="none" strokeWidth="2.4"
            />
            <path
              className="ptr-spinner-arc"
              d="M12 3 a9 9 0 0 1 9 9"
              fill="none" strokeWidth="2.4" strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
      {children}
    </>
  );
};

export default PullToRefresh;
