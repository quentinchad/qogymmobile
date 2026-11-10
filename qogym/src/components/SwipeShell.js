import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { saveLastRoute } from '../utils/lastRoute';
import './SwipeShell.css';

/**
 * SwipeShell
 * ---------------------------------------------------------------------------
 * Carousel horizontal type Instagram/TikTok pour les pages principales.
 *
 * Architecture :
 *   - Les `mainSlides` (Feed, Séances, Qojim, Profil) sont montés EN PERMANENCE
 *     dans un rail horizontal (translate3d, GPU-accelerated). Ils ne sont
 *     jamais démontés tant qu'on reste dans l'app : leur état (scroll,
 *     données chargées, etc.) est préservé entre les swipes ET même quand
 *     on quitte vers une route non-main puis qu'on revient.
 *   - Les routes non-main (`children`) sont rendues PAR-DESSUS le rail dans
 *     un overlay quand l'URL est hors mainPages. Sinon l'overlay est masqué.
 *
 * Geste tactile :
 *   - Détection initiale (8px) : décide si le geste est horizontal ou
 *     vertical. Vertical = laisse le scroll natif. Horizontal = on prend
 *     la main, on bloque le scroll, on suit le doigt.
 *   - Au relâchement : snap vers la page voisine si > 20% de largeur OU
 *     vélocité haute (flick), retour à la position courante sinon.
 *
 * URL = source de vérité :
 *   - Au mount, currentIndex est dérivé de l'URL.
 *   - Quand le swipe finit sur un nouvel index, on appelle navigate() pour
 *     mettre à jour l'URL. Les pages ne se remontent pas (elles étaient
 *     déjà là dans le rail).
 *   - Si l'URL change pour une autre raison (clic BottomNav, back/forward),
 *     useEffect détecte et anime vers la nouvelle position.
 *
 * Compat :
 *   - data-no-swipe : opt-out manuel pour modales custom (ex. RestTimePicker)
 *   - Détection auto des scrollers horizontaux : laisse les tabs admin et
 *     les tableaux scroller naturellement.
 *   - Sur desktop ou si user n'est pas connecté, le carousel est désactivé
 *     (rend juste les Routes en mode classique).
 * ---------------------------------------------------------------------------
 */

// Seuils du geste
const HORIZONTAL_DETECT  = 12;    // px : décide si le geste est horizontal
const VERTICAL_TOLERANCE = 16;    // px : si on dépasse en Y avant H, on annule
const SWIPE_THRESHOLD    = 0.35;  // 35% de la largeur du viewport
const VELOCITY_THRESHOLD = 0.7;   // px/ms — vrai flick

const MOBILE_BREAKPOINT = 768;

const SwipeShell = ({ user, mainSlides, children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isMainPath = (path) => mainSlides.some(s => s.path === path);
  const onMainPage = isMainPath(location.pathname);

  // Mémorise la dernière page main visitée. Sert à restaurer la bonne page
  // au boot après un pull-to-refresh / rechargement de la WebView (sinon on
  // retombe sur /feed à cause de la redirection par défaut de App.js).
  useEffect(() => {
    if (onMainPage) saveLastRoute(location.pathname);
  }, [onMainPage, location.pathname]);

  const containerRef = useRef(null);
  const widthRef     = useRef(0);
  // La largeur du conteneur est aussi en state pour déclencher un re-render
  // dès qu'on la mesure : le calcul du transform en pixels en dépend, et
  // on ne peut pas se contenter d'une ref (les refs n'invalident pas).
  const [containerWidth, setContainerWidth] = useState(0);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);

  // Mesure synchrone APRÈS mount mais AVANT paint : le tout premier rendu
  // visible a déjà la bonne largeur, donc le rail démarre directement à la
  // bonne position si on arrive sur /sessions par exemple.
  useLayoutEffect(() => {
    if (containerRef.current) {
      const w = containerRef.current.clientWidth;
      widthRef.current = w;
      setContainerWidth(w);
    }
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        widthRef.current = w;
        setContainerWidth(w);
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Index dérivé de l'URL (pour les pages main). Si URL non-main, on garde
  // la dernière main visitée (le carousel reste à sa position d'origine).
  const indexFromPath = useMemo(() => {
    const i = mainSlides.findIndex(s => s.path === location.pathname);
    return i >= 0 ? i : null;
  }, [location.pathname, mainSlides]);

  const [currentIndex, setCurrentIndex] = useState(() => {
    return indexFromPath !== null ? indexFromPath : 0;
  });

  // Sync : URL → index. Si on arrive sur une main page, on aligne le rail.
  useEffect(() => {
    if (indexFromPath !== null && indexFromPath !== currentIndex) {
      setAnimating(true);
      setDragOffset(0);
      setCurrentIndex(indexFromPath);
      const t = setTimeout(() => setAnimating(false), 280);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexFromPath]);

  // Drag state
  const dragRef = useRef({
    active: false, startX: 0, startY: 0, startTime: 0,
    lastX: 0, lastTime: 0, velocity: 0, intent: null,
  });
  const [dragOffset, setDragOffset] = useState(0);
  const [animating,  setAnimating]  = useState(false);

  const blockedByContent = useCallback((target) => {
    let el = target;
    while (el && el !== containerRef.current && el.nodeType === 1) {
      if (el.hasAttribute && el.hasAttribute('data-no-swipe')) return true;
      if (el.scrollWidth > el.clientWidth) {
        const style = window.getComputedStyle(el);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
      }
      el = el.parentElement;
    }
    return false;
  }, []);

  const swipeEnabled = isMobile && onMainPage && mainSlides.length > 1;

  const onTouchStart = (e) => {
    if (!swipeEnabled) return;
    // Bloque tout nouveau swipe tant que la transition snap est en cours :
    // ça évite l'effet "je swipe vite plusieurs fois et je me retrouve à l'autre
    // bout" parce que React n'a pas encore propagé le nouveau currentIndex.
    if (animating) return;
    if (blockedByContent(e.target)) return;
    // Re-mesure défensive : la largeur peut avoir changé depuis le dernier
    // resize sans qu'on l'ait vue (rotation rapide, modale fermée, etc.).
    if (containerRef.current) widthRef.current = containerRef.current.clientWidth;
    const t = e.touches[0];
    dragRef.current = {
      active: true,
      startX: t.clientX,
      startY: t.clientY,
      startTime: performance.now(),
      lastX: t.clientX,
      lastTime: performance.now(),
      velocity: 0,
      intent: null,
    };
  };

  const onTouchMove = (e) => {
    if (!swipeEnabled) return;
    const d = dragRef.current;
    if (!d.active) return;

    const t  = e.touches[0];
    const dx = t.clientX - d.startX;
    const dy = t.clientY - d.startY;

    if (d.intent === null) {
      // Pour capturer l'axe horizontal, on exige que |dx| soit nettement
      // supérieur à |dy| (1.3×) et au-dessus du seuil de détection. Sinon
      // les gestes diagonaux ou tremblants déclenchent le swipe par erreur.
      if (Math.abs(dx) > HORIZONTAL_DETECT && Math.abs(dx) > Math.abs(dy) * 1.3) {
        d.intent = 'h';
      } else if (Math.abs(dy) > VERTICAL_TOLERANCE) {
        d.intent = 'v';
      }
    }
    if (d.intent !== 'h') return;

    if (e.cancelable) e.preventDefault();

    const now = performance.now();
    const dt  = now - d.lastTime;
    if (dt > 0) {
      d.velocity = (t.clientX - d.lastX) / dt;
      d.lastX = t.clientX;
      d.lastTime = now;
    }

    // Rebond aux extrémités
    let translated = dx;
    if (currentIndex === 0 && dx > 0) translated = dx * 0.35;
    else if (currentIndex === mainSlides.length - 1 && dx < 0) translated = dx * 0.35;

    setDragOffset(translated);
  };

  const endDrag = () => {
    if (!swipeEnabled) return;
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;

    if (d.intent !== 'h') {
      setDragOffset(0);
      return;
    }

    const w = widthRef.current || 1;
    const offset = dragOffset;
    const speed  = d.velocity;

    let nextIndex = currentIndex;
    const passedThreshold = Math.abs(offset) > w * SWIPE_THRESHOLD;
    const fastSwipe       = Math.abs(speed) > VELOCITY_THRESHOLD;

    if ((passedThreshold || fastSwipe) && offset !== 0) {
      if (offset < 0 && currentIndex < mainSlides.length - 1) nextIndex = currentIndex + 1;
      else if (offset > 0 && currentIndex > 0)                nextIndex = currentIndex - 1;
    }

    setAnimating(true);
    setDragOffset(0);
    setTimeout(() => setAnimating(false), 280);

    if (nextIndex !== currentIndex) {
      setCurrentIndex(nextIndex);
      navigate(mainSlides[nextIndex].path, { replace: false });
    }
  };

  // Calcul du translateX du rail — en PIXELS (pas en %).
  //
  // Pourquoi : avec `transform: translateX(N%)`, les `%` sont calculés par
  // rapport à la largeur de l'élément translaté lui-même (le track). Or le
  // track fait `width: ${mainSlides.length * 100}%` du conteneur (donc 400%
  // pour 4 slides). Translater de -100% du track = -400% du conteneur =
  // 4 viewports hors écran. On voit alors un slide aléatoire ou rien.
  //
  // En pixels c'est sans ambiguïté : -currentIndex * largeurDuConteneur.
  const railTranslatePx = -currentIndex * containerWidth + dragOffset;

  return (
    <div
      ref={containerRef}
      className={`swipe-shell ${swipeEnabled ? 'mobile' : 'desktop'}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endDrag}
      onTouchCancel={endDrag}
    >
      {/* Le rail des pages principales reste TOUJOURS monté.
          Quand on est sur une route non-main, l'overlay le couvre. */}
      <div
        className={`swipe-shell-track ${animating ? 'animating' : ''} ${
          dragOffset !== 0 ? 'dragging' : ''
        }`}
        style={{
          width: `${mainSlides.length * 100}%`,
          transform: `translate3d(${railTranslatePx}px, 0, 0)`,
        }}
      >
        {mainSlides.map((slide, i) => (
          <div
            key={slide.path}
            className="swipe-shell-slide"
            aria-hidden={i !== currentIndex || !onMainPage}
            // Optimisation : sur les slides hors-écran, on coupe les
            // pointer-events pour éviter les clics fantômes.
            style={{ pointerEvents: i === currentIndex && onMainPage ? 'auto' : 'none' }}
          >
            {slide.element}
          </div>
        ))}
      </div>

      {/* Overlay : routes non-main rendues par-dessus le rail.
          Quand on est sur une main page, l'overlay est invisible et
          inactif aux clics, donc le rail reste interactif. */}
      <div className={`swipe-shell-overlay ${onMainPage ? 'hidden' : ''}`}>
        {!onMainPage && children}
      </div>
    </div>
  );
};

export default SwipeShell;