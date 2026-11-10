import React from 'react';
import { Outlet } from 'react-router-dom';

const PagePreview = ({ page, isActive, isPreview, scale = 0.9, opacity = 0.7 }) => {
  const getPageTitle = (pathname) => {
    const titles = {
      '/feed': 'Feed',
      '/sessions': 'Séances',
      '/qojim': 'Qojim',
      '/profile': 'Profil',
      '/login': 'Connexion'
    };
    return titles[pathname] || 'Page';
  };

  const getPageIcon = (pathname) => {
    const icons = {
      '/feed': 'feed.png',
      '/sessions': 'seances.png',
      '/qojim': 'qojim.png',
      '/profile': 'profil.png',
      '/login': 'profil.png'
    };
    return icons[pathname] || 'feed.png';
  };

  if (!page) return null;

  return (
    <div 
      className={`page-preview ${isActive ? 'active' : ''} ${isPreview ? 'preview' : ''}`}
      style={{
        transform: `scale(${scale})`,
        opacity: opacity,
        transformOrigin: 'center center'
      }}
    >
      {/* Header de l'aperçu */}
      <div className="preview-header">
        <div className="preview-nav-info">
          <img 
            src={`https://qojim.com/icones/${getPageIcon(page)}`}
            alt={getPageTitle(page)}
            className="preview-nav-icon"
          />
          <span className="preview-nav-title">{getPageTitle(page)}</span>
        </div>
      </div>
      
      {/* Contenu de l'aperçu - version floutée/simplifiée */}
      <div className="preview-content">
        <div className="preview-placeholder">
          <div className="preview-skeleton">
            <div className="skeleton-header"></div>
            <div className="skeleton-cards">
              <div className="skeleton-card"></div>
              <div className="skeleton-card"></div>
              <div className="skeleton-card"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PagePreview;
