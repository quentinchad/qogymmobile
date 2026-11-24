import React, { useCallback, useEffect, useRef, useState } from 'react';
import { musicService } from '../services/api';
import { useToast } from './Toast';
import './WorkoutMusic.css';

/**
 * Musique d'un entraînement, façon "notes Instagram".
 *
 * L'auteur peut associer (facultatif) un titre Deezer à son entraînement.
 * À l'ouverture du détail, l'extrait officiel de 30 s joue en boucle ; il
 * s'arrête quand le détail se ferme. Un bouton coupe / remet le son, et ce
 * choix est retenu sur l'appareil.
 *
 * L'audio est diffusé directement depuis le CDN Deezer : rien n'est
 * téléchargé ni stocké chez QoGym. Le lien de l'extrait expire au bout de
 * ~15 min, il est donc redemandé à chaque ouverture.
 *
 * Props :
 *   - workout  : entraînement affiché (avec `id`, `music`)
 *   - isOwn    : l'utilisateur connecté en est l'auteur (peut choisir le son)
 *   - onChange : (music | null) => void, après un choix / un retrait
 */

const MUTE_KEY = 'qogym_music_muted';
const readMuted = () => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
};
const writeMuted = (v) => {
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* stockage indisponible */ }
};

// Un seul extrait à la fois dans toute l'appli.
let sharedAudio = null;
const getAudio = () => {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.loop = true;
    sharedAudio.preload = 'auto';
    sharedAudio.volume = 0.8;
  }
  return sharedAudio;
};
const stopAudio = () => {
  if (!sharedAudio) return;
  sharedAudio.pause();
  sharedAudio.removeAttribute('src');
  sharedAudio.load();
};

/**
 * Lecture en boucle de l'extrait d'un titre.
 * status : 'idle' | 'loading' | 'playing' | 'blocked' (lecture auto refusée
 * par le navigateur : il faut un appui) | 'error'
 */
function usePreviewLoop(trackId) {
  const [status, setStatus] = useState('idle');
  const [muted, setMutedState] = useState(readMuted);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const tryPlay = useCallback(() => {
    const audio = getAudio();
    audio.muted = mutedRef.current;
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => setStatus('playing')).catch((err) => {
        setStatus(err && err.name === 'NotAllowedError' ? 'blocked' : 'error');
      });
    } else {
      setStatus('playing');
    }
  }, []);

  useEffect(() => {
    if (!trackId) { setStatus('idle'); return undefined; }
    let cancelled = false;
    setStatus('loading');
    musicService.preview(trackId)
      .then((res) => {
        if (cancelled) return;
        const url = res.data?.preview_url;
        if (!url) { setStatus('error'); return; }
        const audio = getAudio();
        audio.src = url;
        tryPlay();
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => {
      cancelled = true;
      stopAudio();
    };
  }, [trackId, tryPlay]);

  // Onglet masqué → pause ; retour → reprise
  useEffect(() => {
    if (!trackId) return undefined;
    const onVis = () => {
      const audio = sharedAudio;
      if (!audio || !audio.src) return;
      if (document.hidden) audio.pause();
      else if (status === 'playing') audio.play().catch(() => setStatus('blocked'));
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [trackId, status]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    setMutedState(next);
    writeMuted(next);
    if (sharedAudio) sharedAudio.muted = next;
    // Remettre le son vaut "appui" : on relance si le navigateur avait bloqué
    if (!next && status === 'blocked') tryPlay();
  }, [status, tryPlay]);

  return { status, muted, toggleMute, play: tryPlay };
}

/** Recherche + choix d'un titre (réservé à l'auteur). */
const MusicPicker = ({ onPick, onCancel, busy }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setError(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      musicService.search(term)
        .then((res) => {
          if (cancelled) return;
          setResults(res.data?.tracks || []);
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err.response?.data?.error || 'Recherche indisponible');
        })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="wm-picker">
      <div className="wm-picker-row">
        <input
          type="search"
          className="wm-picker-input"
          placeholder="Rechercher un titre ou un artiste…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          maxLength={100}
          disabled={busy}
        />
        <button type="button" className="btn btn-secondary btn-small" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
      </div>
      {searching && <div className="wm-picker-hint">Recherche…</div>}
      {error && <div className="wm-picker-hint wm-picker-error">{error}</div>}
      {!searching && !error && q.trim().length >= 2 && results.length === 0 && (
        <div className="wm-picker-hint">Aucun titre trouvé.</div>
      )}
      <ul className="wm-results">
        {results.map((t) => (
          <li key={t.track_id}>
            <button type="button" className="wm-result" onClick={() => onPick(t)} disabled={busy}>
              {t.cover_url
                ? <img src={t.cover_url} alt="" className="wm-cover wm-cover--sm" loading="lazy" />
                : <span className="wm-cover wm-cover--sm wm-cover--empty">♪</span>}
              <span className="wm-text">
                <span className="wm-title">
                  {t.title}
                  {t.explicit && <span className="wm-explicit" title="Paroles explicites">E</span>}
                </span>
                <span className="wm-artist">{t.artist}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="wm-credit">Extraits de 30 s fournis par Deezer</div>
    </div>
  );
};

const WorkoutMusic = ({ workout, isOwn, onChange }) => {
  const { showToast } = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Les séances externes (Recomp, id "recomp:…") n'ont pas de musique
  const supported = workout && /^\d+$/.test(String(workout.id));
  const music = supported ? workout.music || null : null;
  const { status, muted, toggleMute, play } = usePreviewLoop(picking ? null : music?.track_id);

  if (!supported || (!music && !isOwn)) return null;

  const pick = async (track) => {
    setBusy(true);
    try {
      const res = await musicService.setForWorkout(workout.id, track.track_id);
      onChange?.(res.data?.music || null);
      setPicking(false);
    } catch (err) {
      showToast(err.response?.data?.error || "Impossible d'ajouter ce son", 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await musicService.removeFromWorkout(workout.id);
      onChange?.(null);
    } catch (err) {
      showToast(err.response?.data?.error || 'Impossible de retirer le son', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (picking) {
    return <MusicPicker onPick={pick} onCancel={() => setPicking(false)} busy={busy} />;
  }

  if (!music) {
    return (
      <button type="button" className="wm-add" onClick={() => setPicking(true)}>
        <span aria-hidden="true">♪</span> Ajouter un son
      </button>
    );
  }

  const playing = status === 'playing' && !muted;

  return (
    <div className={`wm-card${playing ? ' wm-card--playing' : ''}`}>
      {music.cover_url
        ? <img src={music.cover_url} alt="" className="wm-cover" />
        : <span className="wm-cover wm-cover--empty">♪</span>}
      <div className="wm-text">
        <span className="wm-title">{music.title}</span>
        <span className="wm-artist">
          {music.artist}
          {music.link && (
            <>
              {' · '}
              <a href={music.link} target="_blank" rel="noopener noreferrer" className="wm-source">Deezer</a>
            </>
          )}
        </span>
        {isOwn && (
          <span className="wm-owner-actions">
            <button type="button" onClick={() => setPicking(true)} disabled={busy}>Changer</button>
            <button type="button" onClick={remove} disabled={busy}>Retirer</button>
          </span>
        )}
      </div>
      {status === 'blocked' ? (
        <button type="button" className="wm-btn" onClick={play} aria-label="Écouter l'extrait">▶</button>
      ) : status === 'error' ? (
        <span className="wm-unavailable" title="Extrait indisponible">—</span>
      ) : (
        <button
          type="button"
          className="wm-btn"
          onClick={toggleMute}
          aria-label={muted ? 'Activer le son' : 'Couper le son'}
          aria-pressed={muted}
        >
          {status === 'loading' ? <span className="wm-spinner" /> : playing ? (
            <span className="wm-eq" aria-hidden="true"><i /><i /><i /></span>
          ) : '🔇'}
        </button>
      )}
    </div>
  );
};

/** Petite ligne "♪ Titre · Artiste" pour les cartes du fil. */
export const MusicTag = ({ music }) => {
  if (!music) return null;
  return (
    <div className="wm-tag" title={`${music.title} · ${music.artist}`}>
      <span aria-hidden="true">♪</span> {music.title} · {music.artist}
    </div>
  );
};

export default WorkoutMusic;
