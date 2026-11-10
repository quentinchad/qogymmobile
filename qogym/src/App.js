import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { authService } from './services/api';

// Pages
import Feed from './pages/Feed';
import Login from './pages/Login';
import Register from './pages/Register';
import Sessions from './pages/Sessions';
import SessionDetail from './pages/SessionDetail';
import CreateSession from './pages/CreateSession';
import QojimSessions from './pages/QojimSessions';
import Workout from './pages/Workout';
import Profile from './pages/Profile';
import Nutrition from './pages/Nutrition';
import Admin from './pages/Admin';
import ChangePassword from './pages/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import UserProfile from './pages/UserProfile';
import MonthlyReport from './pages/MonthlyReport';
import ExerciseLibrary from './pages/ExerciseLibrary';
import ExerciseProgress from './pages/ExerciseProgress';

// Layout
import BottomNav from './components/BottomNav';
import SwipeShell from './components/SwipeShell';
import PullToRefresh from './components/PullToRefresh';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmModal';
import { ActiveWorkoutProvider } from './contexts/ActiveWorkoutContext';
import MiniWorkout from './components/MiniWorkout';
import UpdateBanner from './components/UpdateBanner';
import { getLastRoute } from './utils/lastRoute';

import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('qogym_token');
    const savedUser = localStorage.getItem('qogym_user');
    
    console.log('🔍 Vérification du token:', token ? 'présent' : 'absent');
    
    if (token && savedUser) {
      try {
        // D'abord on charge l'utilisateur sauvegardé
        setUser(JSON.parse(savedUser));
        setLoading(false);
        
        // Puis on vérifie le token en arrière-plan
        const response = await authService.verifyToken();
        console.log('✅ Token valide, user:', response.data.user);
        setUser(response.data.user);
      } catch (error) {
        console.error('❌ Token invalide:', error.response?.data || error.message);
        localStorage.removeItem('qogym_token');
        localStorage.removeItem('qogym_user');
        setUser(null);
        setLoading(false);
      }
    } else {
      console.log('ℹ️ Aucun token ou utilisateur trouvé - Mode public');
      setLoading(false);
    }
  };

  const handleLogin = useCallback((userData, token) => {
    console.log('🔐 Connexion:', userData, 'Token:', token);
    localStorage.setItem('qogym_token', token);
    localStorage.setItem('qogym_user', JSON.stringify(userData));
    setUser(userData);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Erreur lors de la déconnexion', error);
    }
    localStorage.removeItem('qogym_token');
    localStorage.removeItem('qogym_user');
    setUser(null);
  }, []);

  // Met à jour partiellement le user (ex. après changement de username).
  // Préserve le token et persiste dans localStorage pour que le state
  // survive à un reload.
  const handleUserUpdate = useCallback((patch) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('qogym_user', JSON.stringify(next));
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Chargement...</p>
      </div>
    );
  }

  return (
    <Router>
      <ToastProvider>
        <ConfirmProvider>
          <ActiveWorkoutProvider user={user}>
            <AppShell user={user} onLogin={handleLogin} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
          </ActiveWorkoutProvider>
        </ConfirmProvider>
      </ToastProvider>
    </Router>
  );
}

/**
 * BootRouteRestorer — restaure la dernière page main visitée au démarrage.
 *
 * Pourquoi : après un pull-to-refresh (ou un rechargement de la WebView par
 * Android), le wrapper recharge souvent l'URL racine. Sans ça, on retombe
 * systématiquement sur /feed alors qu'on était par ex. sur Nutrition.
 *
 * Comportement : UNE SEULE FOIS, au tout premier rendu, si l'URL courante
 * est "neutre" (racine `/`, ou pathname vide), on redirige vers la dernière
 * route mémorisée. Si l'utilisateur a ouvert une URL profonde précise
 * (/workout/…, /session/…, ou même directement /nutrition), on NE touche à
 * rien : son intention explicite prime.
 */
function BootRouteRestorer() {
  const navigate = useNavigate();
  const didRunRef = React.useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;
    const path = window.location.pathname;
    // On ne restaure que si on arrive sur une route "neutre". `/` et `''`
    // sont les seules valeurs qui mènent à la redirection par défaut /feed.
    const isNeutral = path === '/' || path === '' || path === '/index.html';
    if (!isNeutral) return;
    const last = getLastRoute();
    if (last && last !== path) {
      navigate(last, { replace: true });
    }
  }, [navigate]);

  return null;
}

/**
 * AppShell — rendu à l'intérieur du <Router> pour pouvoir utiliser les hooks
 * de routing (useNavigate, useLocation) dans SwipeShell.
 */
function AppShell({ user, onLogin, onLogout, onUserUpdate }) {
  // Les pages principales sont mémorisées : leurs `element` sont créés UNE
  // SEULE FOIS (sauf si `user` change). Si on les recréait à chaque render,
  // SwipeShell les remonterait et on perdrait l'état (scroll, données).
  const mainSlides = useMemo(() => {
    if (!user) return []; // Sans user, pas de carousel — fallback aux routes classiques
    // /qojim a été retirée du carousel pour alléger la nav. Elle reste
    // accessible via un bouton sur la page Séances et via l'URL directe
    // (cf. nonMainRoutes ci-dessous).
    const slides = [
      { path: '/feed',      element: <Feed user={user} /> },
      { path: '/sessions',  element: <Sessions user={user} /> },
      // Module Nutrition : disponible pour tout utilisateur connecté.
      { path: '/nutrition', element: <Nutrition user={user} /> },
      { path: '/profile',   element: <Profile user={user} onLogout={onLogout} onUserUpdate={onUserUpdate} /> },
    ];
    return slides;
  }, [user, onLogout, onUserUpdate]);

  // Routes non-main : workout, login, register, admin, modales, etc.
  // Ces routes sont rendues dans l'overlay du SwipeShell quand l'URL n'est
  // pas une main page. Le composant SwipeShell gère lui-même cette logique.
  const nonMainRoutes = (
    <Routes>
      {/* Pages publiques */}
      <Route path="/login"    element={<Login    onLogin={onLogin} />} />
      <Route path="/register" element={<Register onLogin={onLogin} />} />

      {/* Si pas de user, on tombe sur les routes classiques aussi pour les
          pages qui sont normalement dans le carousel. */}
      {!user && <Route path="/feed"      element={<Feed     user={user} />} />}
      {!user && <Route path="/sessions"  element={<Sessions user={user} />} />}
      {!user && <Route path="/nutrition" element={<Nutrition user={user} />} />}

      {/* Qojim : sortie du carousel, accessible via route classique (et
          déclenchée par le bouton "Voir les séances Qojim" sur /sessions). */}
      <Route path="/qojim" element={<QojimSessions user={user} />} />

      {/* Mot de passe */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password"  element={<ResetPassword />} />

      {/* Confirmation d'email après inscription */}
      <Route path="/verify-email" element={<VerifyEmail onLogin={onLogin} />} />

      {/* CreateSession */}
      <Route path="/create-session"     element={<CreateSession user={user} />} />
      <Route path="/create-session/:id" element={user ? <CreateSession user={user} /> : <Navigate to="/login" />} />

      {/* Détail séance */}
      <Route path="/session/:id" element={<SessionDetail user={user} />} />

      {/* Routes nécessitant auth */}
      <Route path="/workout/:sessionId"  element={user ? <Workout user={user} /> : <Navigate to="/login" />} />
      <Route path="/change-password"     element={user ? <ChangePassword user={user} /> : <Navigate to="/login" />} />
      <Route path="/user/:userId"        element={user ? <UserProfile user={user} /> : <Navigate to="/login" />} />
      <Route path="/monthly-report/:year/:month" element={user ? <MonthlyReport /> : <Navigate to="/login" />} />

      {/* Bibliothèque d'exercices + progression détaillée (soi-même ou un ami) */}
      <Route path="/exercises/:userId"                  element={user ? <ExerciseLibrary  user={user} /> : <Navigate to="/login" />} />
      <Route path="/exercises/:userId/:exerciseName"     element={user ? <ExerciseProgress user={user} /> : <Navigate to="/login" />} />

      {/* Admin */}
      {user?.is_admin && <Route path="/admin" element={<Admin user={user} />} />}

      {/* Redirection par défaut */}
      <Route path="/"  element={<Navigate to="/feed" replace />} />
      <Route path="*"  element={<Navigate to="/feed" replace />} />
    </Routes>
  );

  return (
    <div className={`app ${user ? 'app-authenticated' : 'app-public'}`}>
      {/* Restaure la dernière page main après un pull-to-refresh / reload
          de la WebView (sinon retour systématique sur /feed). */}
      <BootRouteRestorer />

      {/* Bannière de mise à jour de l'APK Android — visible uniquement
          dans l'app native (vérification interne via window.QOGYM_IS_NATIVE_APP) */}
      <UpdateBanner />

      {/* PullToRefresh : ne s'active QUE dans le contexte app (WebView).
          Sur navigateur, il rend juste ses enfants sans rien changer. */}
      <PullToRefresh>
        {user ? (
          <SwipeShell user={user} mainSlides={mainSlides}>
            {nonMainRoutes}
          </SwipeShell>
        ) : (
          <div className="app-content">{nonMainRoutes}</div>
        )}
      </PullToRefresh>

      {/* Mini-card du workout en cours, visible sur toutes les pages
          sauf la page workout elle-même */}
      {user && <MiniWorkout />}

      {/* Navigation toujours visible */}
      <BottomNav user={user} />
    </div>
  );
}

export default App;