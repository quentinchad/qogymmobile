import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './RestTimePicker.css';

/**
 * Generate the available rest values: 0s, 15s, 30s … 5min (step = 15s).
 */
const STEP = 15;
const MAX = 300;
const VALUES = (() => {
  const arr = [];
  for (let v = 0; v <= MAX; v += STEP) arr.push(v);
  return arr;
})();

const formatRest = (s) => {
  if (s === 0) return '0s';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return `${m}min`;
  return `${m}m${String(sec).padStart(2, '0')}`;
};

const ITEM_H = 44; // px — must match CSS .rtp-item height

/**
 * Wheel-style picker. Vertical scroll-snap column with the centre row
 * highlighted. Works with touch, mouse drag, mouse wheel and keyboard.
 *
 * Props:
 *   value        — current rest (seconds)
 *   onChange     — (seconds) => void
 *   onClose      — () => void  (called when the user dismisses)
 */
const RestTimePicker = ({ value, onChange, onClose }) => {
  const listRef = useRef(null);
  const [selected, setSelected] = useState(() => {
    // Snap incoming value to nearest valid step
    const idx = Math.max(0, Math.min(VALUES.length - 1, Math.round(value / STEP)));
    return VALUES[idx];
  });
  const settleTimer = useRef(null);
  const isProgrammaticScroll = useRef(false);

  // Centre the list on the current value when opening
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const idx = VALUES.indexOf(selected);
    isProgrammaticScroll.current = true;
    el.scrollTop = idx * ITEM_H;
    // Release the flag after the scroll has been applied
    requestAnimationFrame(() => {
      isProgrammaticScroll.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect when scrolling has settled and snap to nearest item
  const handleScroll = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = listRef.current;
      if (!el) return;
      const idx = Math.round(el.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(VALUES.length - 1, idx));
      const target = clamped * ITEM_H;
      // Soft-snap if not perfectly aligned
      if (!isProgrammaticScroll.current && Math.abs(el.scrollTop - target) > 1) {
        isProgrammaticScroll.current = true;
        el.scrollTo({ top: target, behavior: 'smooth' });
        setTimeout(() => { isProgrammaticScroll.current = false; }, 250);
      }
      const v = VALUES[clamped];
      if (v !== selected) setSelected(v);
    }, 90);
  }, [selected]);

  // Keyboard support
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose && onClose(); return; }
      if (e.key === 'Enter') {
        onChange(selected);
        onClose && onClose();
        return;
      }
      const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      const idx = VALUES.indexOf(selected);
      const next = Math.max(0, Math.min(VALUES.length - 1, idx + dir));
      setSelected(VALUES[next]);
      const el = listRef.current;
      if (el) {
        isProgrammaticScroll.current = true;
        el.scrollTo({ top: next * ITEM_H, behavior: 'smooth' });
        setTimeout(() => { isProgrammaticScroll.current = false; }, 250);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onChange, onClose]);

  const tapValue = (v) => {
    setSelected(v);
    const el = listRef.current;
    if (el) {
      isProgrammaticScroll.current = true;
      el.scrollTo({ top: VALUES.indexOf(v) * ITEM_H, behavior: 'smooth' });
      setTimeout(() => { isProgrammaticScroll.current = false; }, 250);
    }
  };

  const confirm = () => {
    onChange(selected);
    onClose && onClose();
  };

  return ReactDOM.createPortal(
    <div className="rtp-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="rtp-modal" data-no-swipe>
        <div className="rtp-title">Temps de repos</div>

        <div className="rtp-wheel">
          <div className="rtp-window" />
          <div
            className="rtp-list"
            ref={listRef}
            onScroll={handleScroll}
          >
            {/* Top spacer = 2 rows so the first item can be centred */}
            <div className="rtp-spacer" />
            <div className="rtp-spacer" />
            {VALUES.map((v) => (
              <button
                key={v}
                type="button"
                className={`rtp-item${v === selected ? ' rtp-item--selected' : ''}`}
                onClick={() => tapValue(v)}
              >
                {formatRest(v)}
              </button>
            ))}
            <div className="rtp-spacer" />
            <div className="rtp-spacer" />
          </div>
        </div>

        <div className="rtp-actions">
          <button type="button" className="rtp-btn rtp-btn--ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="rtp-btn rtp-btn--primary" onClick={confirm}>Confirmer</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RestTimePicker;
export { formatRest as formatRestTime };