import React, { useState, useRef, useEffect } from 'react';
import { formatOneRepMax } from '../utils/oneRepMax';
import './OneRepMaxBadge.css';

/**
 * Petit badge "🏆 XXkg" affichant le 1RM estimé d'une série. Au clic (ou
 * tap), ouvre une petite note discrète précisant qu'il s'agit d'une
 * estimation — la note se referme automatiquement au clic ailleurs.
 *
 * Utilisé partout où un 1RM est affiché : séance en cours, feed,
 * historique, bibliothèque d'exercices...
 */
const OneRepMaxBadge = ({ value, className = '' }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  if (value === null || value === undefined) return null;

  // Empêche le clic sur le badge de déclencher les gestionnaires du
  // conteneur parent (ouverture d'une modale, long-press, navigation...).
  const stop = (e) => e.stopPropagation();

  return (
    <span className={`orm-badge-wrap ${className}`} ref={wrapRef}>
      <button
        type="button"
        className="orm-badge"
        onClick={(e) => { stop(e); setOpen((o) => !o); }}
        onMouseDown={stop}
        onTouchStart={stop}
      >
        🏆 {formatOneRepMax(value)} kg
      </button>
      {open && (
        <span className="orm-badge-tooltip" onClick={stop} onMouseDown={stop} onTouchStart={stop}>
          1RM estimé — charge théorique à 1 répétition, calculée à partir de la meilleure série.
        </span>
      )}
    </span>
  );
};

export default OneRepMaxBadge;