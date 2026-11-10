import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './UpdateBanner.css';

/**
 * Bannière de mise à jour de l'app native QoGym.
 *
 * Deux modes possibles :
 *
 * 1) MODE NATIVE — l'utilisateur est dans le NOUVEAU APK (qui injecte
 *    window.QOGYM_IS_NATIVE_APP). On lit version.json, on compare avec la
 *    version installée, et au clic la fonction window.QOGYM_INSTALL_UPDATE
 *    déclenche le téléchargement + écran d'install Android automatique.
 *
 * 2) MODE LEGACY — l'utilisateur est sur Android mais SANS la variable
 *    window.QOGYM_IS_NATIVE_APP. Deux cas possibles :
 *      a) il est dans l'ancien APK (universal.apk) — qui charge le site web
 *         mais n'a pas le système d'auto-install
 *      b) il est sur Chrome Android sans avoir installé l'app
 *    Dans les deux cas, on lui propose un téléchargement manuel : clic →
 *    le navigateur télécharge qogym.apk, et l'utilisateur l'installe lui-même.
 *
 * Sur navigateur desktop (Windows, Mac) ou iPhone, la bannière n'apparaît
 * jamais (le téléchargement APK n'a aucun sens).
 */
const VERSION_JSON_URL    = 'https://qojim.com/version.json';
const APK_DOWNLOAD_URL    = 'https://qojim.com/qogym.apk';
const DISMISS_STORAGE_KEY = 'qogym-update-dismissed-version';
// Clé séparée pour le mode legacy (sinon dismiss en legacy = dismiss aussi
// en native après MAJ ; on veut que la nouvelle bannière apparaisse même si
// l'utilisateur avait dismissé l'ancienne version)
const DISMISS_LEGACY_KEY  = 'qogym-update-dismissed-legacy';

// Détection Android — naïve mais suffisante. On exclut les appareils non
// Android pour ne pas polluer l'UI.
const isAndroidDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
};

// Routes où la bannière ne doit PAS s'afficher : pages où l'utilisateur a
// besoin de tout l'écran sans distraction (workout en cours notamment).
// Compare le pathname avec startsWith pour matcher aussi les sous-routes.
const HIDDEN_ROUTES = ['/workout'];

const UpdateBanner = () => {
  const [info, setInfo]           = useState(null);   // contenu de version.json (mode native uniquement)
  const [dismissed, setDismissed] = useState(false);
  // Évite le double-clic : l'ancien APK lance un 2e téléchargement sur le
  // même fichier si on reclique pendant que le 1er tourne → erreur.
  const [downloading, setDownloading] = useState(false);
  const location = useLocation();

  // Détection du nouveau APK : window.QOGYM_IS_NATIVE_APP est injecté par
  // App.tsx (cf. injectedJavaScriptBeforeContentLoaded de la WebView).
  const isNewNativeApp = typeof window !== 'undefined' && window.QOGYM_IS_NATIVE_APP === true;
  const installedVCode = typeof window !== 'undefined' ? Number(window.QOGYM_APP_VERSION_CODE || 0) : 0;
  const onAndroid      = isAndroidDevice();

  // Mode "legacy" : sur Android, mais pas dans le nouveau APK.
  // → Bannière de migration unique vers le nouvel APK.
  const isLegacyMode = onAndroid && !isNewNativeApp;

  // Fetch version.json uniquement en mode native (en legacy on n'en a pas
  // besoin : on propose simplement la dernière version disponible)
  useEffect(() => {
    if (!isNewNativeApp) return;
    let cancelled = false;
    fetch(`${VERSION_JSON_URL}?t=${Date.now()}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (!cancelled && json) setInfo(json); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isNewNativeApp]);

  // Récupère le dismiss persistant
  useEffect(() => {
    try {
      if (isLegacyMode) {
        // En legacy, la clé est figée : "j'ai vu cette bannière, ne plus la
        // remontrer cette session/journée". On stocke un timestamp pour
        // pouvoir la rafficher après quelques jours si besoin.
        const dismissedAt = Number(localStorage.getItem(DISMISS_LEGACY_KEY) || 0);
        const oneWeek = 7 * 24 * 3600 * 1000;
        if (dismissedAt && Date.now() - dismissedAt < oneWeek) {
          setDismissed(true);
        }
      } else if (info) {
        const dismissedFor = localStorage.getItem(DISMISS_STORAGE_KEY);
        if (dismissedFor && Number(dismissedFor) >= info.latestVersionCode) {
          setDismissed(true);
        }
      }
    } catch {}
  }, [info, isLegacyMode]);

  // ── Conditions d'affichage ──
  // Pas Android → jamais de bannière
  if (!onAndroid) return null;

  // Routes "focus" → on cache la bannière pour ne pas distraire
  // (ex: pendant un workout)
  if (HIDDEN_ROUTES.some(p => location.pathname.startsWith(p))) return null;

  // Mode NATIVE : besoin de version.json + version plus ancienne
  if (isNewNativeApp) {
    if (!info) return null;
    if (installedVCode >= info.latestVersionCode) return null;

    const isMandatory = info.minRequiredVersionCode && installedVCode < info.minRequiredVersionCode;
    if (dismissed && !isMandatory) return null;

    const apkUrl = info.downloadUrl || APK_DOWNLOAD_URL;

    const handleUpdate = () => {
      if (downloading) return;
      if (typeof window.QOGYM_INSTALL_UPDATE === 'function') {
        setDownloading(true);
        window.QOGYM_INSTALL_UPDATE(apkUrl);
        // Réactive le bouton après 2 min (en cas d'échec / annulation).
        setTimeout(() => setDownloading(false), 120000);
      } else {
        handleSystemDownload();
      }
    };

    // Plan B : navigation vers l'APK → la WebView le confie au gestionnaire
    // de téléchargements Android (notification de progression, puis « Ouvrir »
    // pour installer). Même résultat que passer par le navigateur.
    const handleSystemDownload = () => {
      setDownloading(true);
      window.location.href = apkUrl;
    };

    const handleDismiss = () => {
      setDismissed(true);
      try { localStorage.setItem(DISMISS_STORAGE_KEY, String(info.latestVersionCode)); } catch {}
    };

    return (
      <div className={`update-banner${isMandatory ? ' update-banner--mandatory' : ''}`}>
        <div className="update-banner-icon" aria-hidden="true">⬇️</div>
        <div className="update-banner-text">
          <strong>
            {isMandatory ? 'Mise à jour requise' : 'Nouvelle version disponible'}
            {info.latestVersion ? ` — ${info.latestVersion}` : ''}
          </strong>
          {downloading
            ? <small className="update-banner-progress">Téléchargement en cours (≈ 1 min), garde l'app ouverte…</small>
            : info.releaseNotes && <small>{info.releaseNotes}</small>}
          {downloading && (
            <button type="button" className="update-banner-link" onClick={handleSystemDownload}>
              Ça bloque ? Télécharger via Android
            </button>
          )}
        </div>
        <div className="update-banner-actions">
          <button type="button" className="update-banner-btn update-banner-btn--primary" onClick={handleUpdate} disabled={downloading}>
            {downloading ? '…' : 'Mettre à jour'}
          </button>
          {!isMandatory && (
            <button type="button" className="update-banner-btn update-banner-btn--ghost" onClick={handleDismiss}>
              Plus tard
            </button>
          )}
        </div>
      </div>
    );
  }

  // Mode LEGACY : Android mais pas dans le nouveau APK
  if (isLegacyMode && !dismissed) {
    const handleDownload = () => {
      // On ne peut pas auto-installer depuis le navigateur — on déclenche
      // juste le téléchargement, l'utilisateur clique ensuite "Installer".
      const a = document.createElement('a');
      a.href = APK_DOWNLOAD_URL;
      a.download = 'qogym.apk';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    const handleDismiss = () => {
      setDismissed(true);
      try { localStorage.setItem(DISMISS_LEGACY_KEY, String(Date.now())); } catch {}
    };

    return (
      <div className="update-banner update-banner--legacy">
        <div className="update-banner-icon" aria-hidden="true">📱</div>
        <div className="update-banner-text">
          <strong>Mise à jour majeure de l'app QoGym</strong>
          <small>
            Télécharge la nouvelle version — installe-la une fois, puis tes
            futures mises à jour seront automatiques.
          </small>
        </div>
        <div className="update-banner-actions">
          <button type="button" className="update-banner-btn update-banner-btn--primary" onClick={handleDownload}>
            Télécharger
          </button>
          <button type="button" className="update-banner-btn update-banner-btn--ghost" onClick={handleDismiss}>
            Plus tard
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default UpdateBanner;