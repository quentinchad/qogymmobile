import React, { useRef, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PagePreview from './PagePreview';

const SwipeContainer = ({ children, user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isHorizontalSwipe, setIsHorizontalSwipe] = useState(false);

  // Détecte si le touch a démarré dans une zone qui scrolle horizontalement
  // (tabs, tableaux, carousels…) ou marquée explicitement `data-no-swipe`.
  // Si c'est le cas, on laisse le navigateur gérer le geste sans déclencher
  // la navigation entre pages.
  const isInsideHorizontalScroller = (target) => {
    let el = target;
    while (el && el !== containerRef.current && el.nodeType === 1) {
      // Opt-out explicite
      if (el.hasAttribute && el.hasAttribute('data-no-swipe')) return true;
      // Détection automatique : élément dont le contenu déborde
      // horizontalement et qui a un overflow-x scrollable.
      if (el.scrollWidth > el.clientWidth) {
        const style = window.getComputedStyle(el);
        const ox = style.overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      el = el.parentElement;
    }
    return false;
  };

  // Pages principales pour la navigation swipe
  const mainPages = user 
    ? ['/feed', '/sessions', '/qojim', '/profile']
    : ['/feed', '/sessions', '/qojim', '/login'];

  const getCurrentPageIndex = () => mainPages.indexOf(location.pathname);
  const getPreviousPage = () => {
    const index = getCurrentPageIndex();
    return index > 0 ? mainPages[index - 1] : null;
  };
  const getNextPage = () => {
    const index = getCurrentPageIndex();
    return index < mainPages.length - 1 ? mainPages[index + 1] : null;
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleTouchMove = (e) => {
      if (!isDragging || !isMobile) return;
      
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      
      // Déterminer si c'est un swipe horizontal ou vertical
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      
      // Si le mouvement est plus vertical qu'horizontal, autoriser le scroll
      if (absDeltaY > absDeltaX && absDeltaY > 10) {
        setIsDragging(false);
        setIsHorizontalSwipe(false);
        return;
      }
      
      // Si c'est un mouvement horizontal significatif
      if (absDeltaX > 10 && absDeltaX > absDeltaY) {
        setIsHorizontalSwipe(true);
        
        // Limiter la distance du swipe
        const maxDelta = Math.min(absDeltaX, window.innerWidth * 0.4);
        const finalDelta = deltaX > 0 ? maxDelta : -maxDelta;
        
        setCurrentX(finalDelta);
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      if (!isDragging || !isMobile || !isHorizontalSwipe) return;
      
      setIsDragging(false);
      setIsHorizontalSwipe(false);
      
      const threshold = window.innerWidth * 0.2; // 20% pour naviguer
      
      if (Math.abs(currentX) > threshold) {
        const currentPageIndex = getCurrentPageIndex();
        
        if (currentX > 0 && currentPageIndex > 0) {
          // Swipe vers la droite - page précédente
          navigate(mainPages[currentPageIndex - 1]);
        } else if (currentX < 0 && currentPageIndex < mainPages.length - 1) {
          // Swipe vers la gauche - page suivante
          navigate(mainPages[currentPageIndex + 1]);
        }
      }
      
      setCurrentX(0);
    };

    if (isDragging) {
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, startX, startY, currentX, isMobile, isHorizontalSwipe, location.pathname, navigate]);

  const handleTouchStart = (e) => {
    if (!isMobile) return;
    // Pas de swipe page si le geste démarre dans une zone qui scrolle
    // horizontalement (tabs admin, tableaux, etc.).
    if (isInsideHorizontalScroller(e.target)) return;

    const touch = e.touches[0];
    setIsDragging(true);
    setStartX(touch.clientX);
    setStartY(touch.clientY);
    setCurrentX(0);
    setIsHorizontalSwipe(false);
  };

  // Ne pas appliquer le swipe sur certaines pages (modales, détails, etc.) ou sur desktop
  const shouldEnableSwipe = () => {
    const excludedPaths = ['/session/', '/workout/', '/create-session', '/admin', '/monthly-report'];
    if (!isMobile) return false;
    if (excludedPaths.some(path => location.pathname.includes(path))) return false;
    // Si on n'est pas sur une page principale connue, ne pas activer le swipe
    // (sinon getCurrentPageIndex() = -1 et un swipe gauche enverrait sur /feed).
    return mainPages.includes(location.pathname);
  };

  // Sur desktop ou pages exclues, retourner simplement les enfants sans wrapper
  if (!shouldEnableSwipe()) {
    return <>{children}</>;
  }

  const previousPage = getPreviousPage();
  const nextPage = getNextPage();
  const dragProgress = Math.abs(currentX) / (window.innerWidth * 0.4);

  return (
    <div
      ref={containerRef}
      className={`swipe-container stack-view ${isDragging ? 'dragging' : ''}`}
      style={{
        touchAction: isDragging && isHorizontalSwipe ? 'none' : 'pan-y'
      }}
      onTouchStart={handleTouchStart}
    >
      {/* Page précédente (visible en arrière-plan) */}
      {previousPage && (
        <div 
          className="page-stack previous"
          style={{
            transform: `translateX(${currentX > 0 ? currentX * 0.3 : 0}px) scale(${0.85 + (currentX > 0 ? dragProgress * 0.1 : 0)})`,
            opacity: 0.3 + (currentX > 0 ? dragProgress * 0.4 : 0),
            zIndex: 1
          }}
        >
          <PagePreview 
            page={previousPage} 
            isActive={false}
            isPreview={true}
            scale={0.85}
            opacity={0.3}
          />
        </div>
      )}

      {/* Page actuelle */}
      <div 
        className="page-stack current"
        style={{
          transform: `translateX(${currentX}px)`,
          zIndex: 2,
          boxShadow: isDragging ? '0 10px 40px rgba(0,0,0,0.3)' : 'none'
        }}
      >
        {children}
      </div>

      {/* Page suivante (visible en arrière-plan) */}
      {nextPage && (
        <div 
          className="page-stack next"
          style={{
            transform: `translateX(${currentX < 0 ? window.innerWidth + currentX * 0.7 : window.innerWidth}px) scale(${0.85 + (currentX < 0 ? dragProgress * 0.1 : 0)})`,
            opacity: 0.3 + (currentX < 0 ? dragProgress * 0.4 : 0),
            zIndex: 1
          }}
        >
          <PagePreview 
            page={nextPage} 
            isActive={false}
            isPreview={true}
            scale={0.85}
            opacity={0.3}
          />
        </div>
      )}

      {/* Indicateurs de swipe */}
      {isDragging && isHorizontalSwipe && Math.abs(currentX) > 10 && (
        <div className="swipe-indicators">
          {currentX > 0 && previousPage && (
            <div className="swipe-indicator swipe-right">
              <span>➜</span>
            </div>
          )}
          {currentX < 0 && nextPage && (
            <div className="swipe-indicator swipe-left">
              <span>➜</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SwipeContainer;