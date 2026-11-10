import React from 'react';
import { NavLink } from 'react-router-dom';

const BottomNav = ({ user }) => {
  // Pages principales toujours visibles. La page Qojim a été retirée de la
  // nav (trop d'items en bas) ; elle reste accessible via un bouton sur la
  // page Séances et via l'URL directe /qojim.
  const publicNavItems = [
    { to: '/feed',     label: 'Feed',    icon: 'feed.png' },
    { to: '/sessions', label: 'Séances', icon: 'seances.png' },
  ];

  // Nutrition : visible pour tout utilisateur connecté.
  // emojiFallback se déclenche si l'icône PNG n'existe pas encore sur le serveur.
  const nutritionItem = { to: '/nutrition', label: 'Nutrition', icon: 'nutrition.png', emojiFallback: '🍎' };
  const authNavItem   = { to: '/profile',   label: 'Profil',    icon: 'profil.png' };
  const loginNavItem  = { to: '/login',     label: 'Connexion', icon: 'profil.png' };
  const adminItem     = { to: '/admin',     label: 'Admin',     icon: 'admin.png' };

  const renderNavItem = (item) => (
    <NavLink key={item.to} to={item.to} className="nav-item">
      <img
        src={`https://qojim.com/icones/${item.icon}`}
        alt={item.label}
        className="nav-icon"
        loading="lazy"
        onError={(e) => {
          // Si l'icône PNG n'existe pas (fallback temporaire), on la remplace
          // par un span affichant l'emoji défini sur l'item.
          if (item.emojiFallback) {
            const span = document.createElement('span');
            span.className = 'nav-icon nav-icon--emoji';
            span.textContent = item.emojiFallback;
            e.currentTarget.replaceWith(span);
          }
        }}
      />
      <div className="nav-label">{item.label}</div>
    </NavLink>
  );

  return (
    <nav className="bottom-nav">
      {publicNavItems.map(renderNavItem)}

      {/* Nutrition : visible pour tous (la page elle-même invite à se
          connecter pour pouvoir saisir des aliments) */}
      {renderNavItem(nutritionItem)}

      {/* Profil si connecté, Connexion sinon */}
      {user ? renderNavItem(authNavItem) : renderNavItem(loginNavItem)}

      {/* Admin */}
      {user?.is_admin && renderNavItem(adminItem)}
    </nav>
  );
};

export default BottomNav;