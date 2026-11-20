import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { weightService } from '../services/api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmModal';
import './WeightSection.css';

/**
 * WeightSection — bloc "Poids" de la page Profil.
 *
 *  - Saisie de la pesée du jour, ou de n'importe quel jour passé (sélecteur
 *    de date). Si une pesée existe déjà pour la date choisie, le formulaire
 *    est pré-rempli et l'enregistrement la corrige (upsert côté API).
 *  - Objectif de poids optionnel (ligne de référence sur la courbe).
 *  - Courbe d'évolution en 3 vues :
 *      · Jour    : chaque pesée + moyenne mobile 7 jours (tendance lissée,
 *                  gomme les variations d'eau/sel au jour le jour)
 *      · Semaine : moyenne par semaine (lundi → dimanche)
 *      · Mois    : moyenne par mois
 *    sur une période au choix (1 mois → tout).
 *  - Indicateurs : poids actuel, évolution semaine vs semaine précédente,
 *    évolution sur 30 jours, depuis le début, reste à faire vs objectif.
 *  - Historique des pesées : clic = modifier, 🗑️ = supprimer.
 *
 * Toutes les pesées sont chargées d'un coup (1 ligne par jour, volume
 * négligeable) et les agrégats sont calculés ici.
 */

// ── Helpers dates (toujours en date LOCALE, format YYYY-MM-DD) ─────────────
const pad = (n) => String(n).padStart(2, '0');
const toISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const todayISO = () => toISO(new Date());
const parseISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const shiftISO = (iso, deltaDays) => {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + deltaDays);
  return toISO(dt);
};
const mondayOf = (iso) => {
  const dt = parseISO(iso);
  const dow = (dt.getDay() + 6) % 7; // 0 = lundi
  dt.setDate(dt.getDate() - dow);
  return toISO(dt);
};
const monthOf = (iso) => `${iso.slice(0, 7)}-01`;

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtDayShort = (iso) => { const dt = parseISO(iso); return `${dt.getDate()}/${dt.getMonth() + 1}`; };
const fmtMonth = (iso) => { const dt = parseISO(iso); return `${MONTHS_SHORT[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`; };
const fmtDayLong = (iso) =>
  parseISO(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const fmtKg = (v, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} kg`;
const fmtDelta = (v) => {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Math.round(v * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `${sign}${Math.abs(r).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
};
const round2 = (v) => Math.round(v * 100) / 100;
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

const VIEWS = [
  { key: 'day',   label: 'Jour' },
  { key: 'week',  label: 'Semaine' },
  { key: 'month', label: 'Mois' },
];
const RANGES = [
  { key: 30,   label: '1 m' },
  { key: 90,   label: '3 m' },
  { key: 180,  label: '6 m' },
  { key: 365,  label: '1 an' },
  { key: null, label: 'Tout' },
];
const HISTORY_PAGE = 10;

const WeightSection = () => {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [entries, setEntries] = useState([]); // [{ day, weight }] trié croissant
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Formulaire de saisie
  const [formDay, setFormDay] = useState(todayISO());
  const [formWeight, setFormWeight] = useState('');
  const [saving, setSaving] = useState(false);

  // Objectif
  const [goalDraft, setGoalDraft] = useState('');
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);

  // Graphique
  const [view, setView] = useState('day');
  const [rangeDays, setRangeDays] = useState(90);

  const [historyCount, setHistoryCount] = useState(HISTORY_PAGE);
  // Historique replié par défaut (peut devenir très long)
  const [historyOpen, setHistoryOpen] = useState(false);

  const byDay = useMemo(() => {
    const m = {};
    entries.forEach((e) => { m[e.day] = e.weight; });
    return m;
  }, [entries]);

  const load = useCallback(async () => {
    try {
      const resp = await weightService.getEntries();
      setMigrationNeeded(!!resp.data.migration_needed);
      setEntries(resp.data.entries || []);
      setGoal(resp.data.goal ?? null);
      setGoalDraft(resp.data.goal != null ? String(resp.data.goal).replace('.', ',') : '');
    } catch (err) {
      console.error('Erreur chargement poids', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pré-remplit le champ quand on change de date (ou au chargement) :
  // s'il existe déjà une pesée ce jour-là, on passe en mode "correction".
  useEffect(() => {
    const existing = byDay[formDay];
    setFormWeight(existing != null ? String(existing).replace('.', ',') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formDay, loading]);

  const existingForDay = byDay[formDay];
  const today = todayISO();
  const todayWeight = byDay[today];

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    if (e) e.preventDefault();
    const w = Number(String(formWeight).replace(',', '.'));
    if (!formWeight || Number.isNaN(w) || w < 20 || w > 400) {
      showToast('Poids invalide (entre 20 et 400 kg)', 'error');
      return;
    }
    if (!formDay || formDay > today) {
      showToast('Choisis une date passée ou aujourd\'hui', 'error');
      return;
    }
    setSaving(true);
    try {
      const resp = await weightService.saveEntry(formDay, round2(w));
      const saved = resp.data.weight;
      setEntries((prev) => {
        const next = prev.filter((x) => x.day !== formDay);
        next.push({ day: formDay, weight: saved });
        next.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        return next;
      });
      showToast(existingForDay != null ? 'Pesée corrigée' : 'Pesée enregistrée', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de l\'enregistrement', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (day) => {
    const ok = await confirm({
      title: 'Supprimer cette pesée ?',
      message: `${fmtDayLong(day)} — ${fmtKg(byDay[day])}`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await weightService.deleteEntry(day);
      setEntries((prev) => prev.filter((x) => x.day !== day));
      if (day === formDay) setFormWeight('');
      showToast('Pesée supprimée', 'success');
    } catch (err) {
      showToast('Erreur lors de la suppression', 'error');
    }
  };

  const handleEdit = (day) => {
    setFormDay(day);
    setFormWeight(String(byDay[day]).replace('.', ','));
    const el = document.getElementById('weight-form');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleSaveGoal = async () => {
    const trimmed = goalDraft.trim();
    let value = null;
    if (trimmed !== '') {
      value = Number(trimmed.replace(',', '.'));
      if (Number.isNaN(value) || value < 20 || value > 400) {
        showToast('Objectif invalide', 'error');
        return;
      }
    }
    setGoalSaving(true);
    try {
      const resp = await weightService.setGoal(value);
      setGoal(resp.data.goal);
      setGoalOpen(false);
      showToast(resp.data.goal == null ? 'Objectif retiré' : 'Objectif enregistré', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de l\'enregistrement', 'error');
    } finally {
      setGoalSaving(false);
    }
  };

  // ── Statistiques ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    const first = entries[0];

    // Moyenne des 7 derniers jours vs 7 jours précédents (plus fiable qu'une
    // comparaison pesée à pesée, qui fluctue de ±1 kg selon l'hydratation).
    const inWindow = (from, to) => entries.filter((e) => e.day >= from && e.day <= to).map((e) => e.weight);
    const cur7 = avg(inWindow(shiftISO(today, -6), today));
    const prev7 = avg(inWindow(shiftISO(today, -13), shiftISO(today, -7)));

    // Évolution sur ~30 jours : dernière pesée vs pesée la plus proche d'il y a 30 j
    const target30 = shiftISO(last.day, -30);
    const ref30 = [...entries].reverse().find((e) => e.day <= target30);

    return {
      current: last.weight,
      currentDay: last.day,
      avg7: cur7,
      weekDelta: cur7 != null && prev7 != null ? cur7 - prev7 : null,
      delta30: ref30 ? last.weight - ref30.weight : null,
      sinceStart: entries.length > 1 ? last.weight - first.weight : null,
      startDay: first.day,
      min: Math.min(...entries.map((e) => e.weight)),
      max: Math.max(...entries.map((e) => e.weight)),
      toGoal: goal != null ? goal - last.weight : null,
    };
  }, [entries, goal, today]);

  // ── Données du graphique ────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (entries.length === 0) return [];
    const fromDay = rangeDays ? shiftISO(today, -(rangeDays - 1)) : entries[0].day;

    if (view === 'day') {
      // Moyenne mobile 7 jours calculée sur toutes les pesées (pour que le
      // début de la période ait déjà une tendance correcte).
      return entries
        .map((e) => {
          const win = entries.filter((x) => x.day <= e.day && x.day > shiftISO(e.day, -7)).map((x) => x.weight);
          return { day: e.day, ts: parseISO(e.day).getTime(), weight: e.weight, trend: round2(avg(win)) };
        })
        .filter((p) => p.day >= fromDay);
    }

    const keyFn = view === 'week' ? mondayOf : monthOf;
    const groups = {};
    entries.forEach((e) => {
      const k = keyFn(e.day);
      (groups[k] = groups[k] || []).push(e.weight);
    });
    const fromKey = keyFn(fromDay);
    return Object.keys(groups)
      .sort()
      .filter((k) => k >= fromKey)
      .map((k) => ({
        day: k,
        ts: parseISO(k).getTime(),
        avg: round2(avg(groups[k])),
        min: Math.min(...groups[k]),
        max: Math.max(...groups[k]),
        count: groups[k].length,
      }));
  }, [entries, view, rangeDays, today]);

  // Tableau des moyennes (semaine / mois) avec variation vs période précédente
  const periodRows = useMemo(() => {
    if (view === 'day') return [];
    return chartData
      .map((p, i) => ({ ...p, delta: i > 0 ? p.avg - chartData[i - 1].avg : null }))
      .reverse()
      .slice(0, 8);
  }, [chartData, view]);

  const yDomain = useMemo(() => {
    const vals = [];
    chartData.forEach((p) => {
      if (p.weight != null) vals.push(p.weight);
      if (p.trend != null) vals.push(p.trend);
      if (p.avg != null) vals.push(p.avg);
    });
    if (goal != null) vals.push(goal);
    if (vals.length === 0) return ['auto', 'auto'];
    const lo = Math.floor(Math.min(...vals) - 1);
    const hi = Math.ceil(Math.max(...vals) + 1);
    return [lo, hi];
  }, [chartData, goal]);

  const xTickFormatter = (ts) => {
    const iso = toISO(new Date(ts));
    if (view === 'month') return fmtMonth(iso);
    return fmtDayShort(iso);
  };

  const renderTooltip = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0].payload;
    let title;
    if (view === 'day') title = fmtDayLong(p.day);
    else if (view === 'week') title = `Semaine du ${fmtDayShort(p.day)}`;
    else title = parseISO(p.day).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return (
      <div className="weight-tooltip">
        <div className="weight-tooltip-title">{title}</div>
        {view === 'day' ? (
          <>
            <div>Pesée : <strong>{fmtKg(p.weight, 1)}</strong></div>
            <div className="weight-tooltip-muted">Tendance 7 j : {fmtKg(p.trend, 1)}</div>
          </>
        ) : (
          <>
            <div>Moyenne : <strong>{fmtKg(p.avg, 1)}</strong></div>
            <div className="weight-tooltip-muted">
              {p.count} pesée{p.count > 1 ? 's' : ''} · min {fmtKg(p.min, 1)} · max {fmtKg(p.max, 1)}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Rendu ────────────────────────────────────────────────────────────────
  if (migrationNeeded) {
    return (
      <div className="card mb-2 weight-section">
        <h3 className="card-title">⚖️ Poids</h3>
        <p className="card-description">
          Fonctionnalité bientôt disponible : la migration
          <code> migration_body_weight_20261120.sql</code> doit être exécutée sur la base de données.
        </p>
      </div>
    );
  }

  const historyDesc = [...entries].reverse();

  return (
    <div className="card mb-2 weight-section">
      <div className="weight-header">
        <h3 className="card-title">⚖️ Poids</h3>
        {todayWeight != null ? (
          <span className="weight-today-badge weight-today-badge--done">Pesée du jour ✓</span>
        ) : (
          !loading && <span className="weight-today-badge">Pas encore pesé aujourd'hui</span>
        )}
      </div>

      {/* Saisie / correction */}
      <form id="weight-form" className="weight-form" onSubmit={handleSave}>
        <div className="weight-form-row">
          <input
            type="date"
            className="weight-date-input"
            value={formDay}
            max={today}
            onChange={(e) => setFormDay(e.target.value || today)}
            disabled={saving}
          />
          <div className="weight-input-wrap">
            <input
              type="text"
              inputMode="decimal"
              className="weight-input"
              value={formWeight}
              onChange={(e) => setFormWeight(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="Ex. 78,4"
              disabled={saving}
              aria-label="Poids en kg"
            />
            <span className="weight-input-unit">kg</span>
          </div>
          <button type="submit" className="btn btn-primary btn-small" disabled={saving || !formWeight}>
            {saving ? '…' : existingForDay != null ? 'Corriger' : 'Enregistrer'}
          </button>
        </div>
        <div className="weight-form-hint">
          {formDay === today ? 'Aujourd\'hui' : fmtDayLong(formDay)}
          {existingForDay != null
            ? ` — déjà saisi : ${fmtKg(existingForDay)}. Modifie la valeur pour la corriger.`
            : ' — aucune pesée pour ce jour.'}
          {formDay !== today && (
            <button type="button" className="weight-link" onClick={() => setFormDay(today)}>
              Revenir à aujourd'hui
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <div className="weight-empty">Chargement…</div>
      ) : entries.length === 0 ? (
        <div className="weight-empty">
          Aucune pesée pour le moment. Saisis ton poids ci-dessus — idéalement chaque matin,
          à jeun, pour une courbe fiable.
        </div>
      ) : (
        <>
          {/* Indicateurs */}
          <div className="weight-stats">
            <div className="weight-stat">
              <div className="weight-stat-val">{fmtKg(stats.current)}</div>
              <div className="weight-stat-lbl">
                Actuel{stats.currentDay !== today ? ` (${fmtDayShort(stats.currentDay)})` : ''}
              </div>
            </div>
            <div className="weight-stat">
              <div className="weight-stat-val">{fmtKg(stats.avg7)}</div>
              <div className="weight-stat-lbl">Moyenne 7 j</div>
            </div>
            <div className="weight-stat">
              <div className={`weight-stat-val ${deltaClass(stats.weekDelta, goal, stats.current)}`}>{fmtDelta(stats.weekDelta)}</div>
              <div className="weight-stat-lbl">vs semaine préc.</div>
            </div>
            <div className="weight-stat">
              <div className={`weight-stat-val ${deltaClass(stats.delta30, goal, stats.current)}`}>{fmtDelta(stats.delta30)}</div>
              <div className="weight-stat-lbl">Sur 30 jours</div>
            </div>
            <div className="weight-stat">
              <div className={`weight-stat-val ${deltaClass(stats.sinceStart, goal, stats.current)}`}>{fmtDelta(stats.sinceStart)}</div>
              <div className="weight-stat-lbl">Depuis le {fmtDayShort(stats.startDay)}</div>
            </div>
            <div className="weight-stat">
              <div className="weight-stat-val">{goal != null ? fmtDelta(stats.toGoal) : '—'}</div>
              <div className="weight-stat-lbl">
                {goal != null ? `Reste (objectif ${fmtKg(goal)})` : 'Pas d\'objectif'}
              </div>
            </div>
          </div>

          {/* Objectif */}
          {goalOpen ? (
            <div className="weight-goal-row">
              <label className="target-label">Objectif</label>
              <div className="weight-input-wrap">
                <input
                  type="text"
                  inputMode="decimal"
                  className="weight-input"
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value.replace(/[^0-9.,]/g, ''))}
                  placeholder="Ex. 75 (vide = aucun)"
                  disabled={goalSaving}
                  autoFocus
                />
                <span className="weight-input-unit">kg</span>
              </div>
              <button type="button" className="btn btn-primary btn-small" onClick={handleSaveGoal} disabled={goalSaving}>
                {goalSaving ? '…' : 'OK'}
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setGoalOpen(false)} disabled={goalSaving}>
                Annuler
              </button>
            </div>
          ) : (
            <button type="button" className="weight-link weight-link--block" onClick={() => setGoalOpen(true)}>
              {goal != null ? 'Modifier mon objectif de poids' : 'Définir un objectif de poids'}
            </button>
          )}

          {/* Graphique */}
          <div className="weight-chart-head">
            <div className="weight-tabs">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={`weight-tab${view === v.key ? ' is-active' : ''}`}
                  onClick={() => setView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="weight-tabs weight-tabs--small">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className={`weight-tab${rangeDays === r.key ? ' is-active' : ''}`}
                  onClick={() => setRangeDays(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="weight-chart" data-no-swipe>
            {chartData.length === 0 ? (
              <div className="weight-empty">Aucune pesée sur cette période.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={xTickFormatter}
                    tick={{ fontSize: 10, fill: '#9aa79a' }}
                    minTickGap={28}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 10, fill: '#9aa79a' }}
                    width={40}
                    allowDecimals={false}
                  />
                  <Tooltip content={renderTooltip} />
                  {goal != null && (
                    <ReferenceLine
                      y={goal}
                      stroke="#2e7d50"
                      strokeDasharray="5 4"
                      label={{ value: 'Objectif', fill: '#9aa79a', fontSize: 10, position: 'insideTopRight' }}
                    />
                  )}
                  {view === 'day' ? (
                    <>
                      <Scatter dataKey="weight" fill="#9aa79a" fillOpacity={0.7} shape="circle" isAnimationActive={false} />
                      <Line
                        type="monotone"
                        dataKey="trend"
                        stroke="#2ecc71"
                        strokeWidth={2.4}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    </>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="avg"
                      stroke="#2ecc71"
                      strokeWidth={2.4}
                      dot={{ r: 3, fill: '#2ecc71' }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          {view === 'day' && chartData.length > 0 && (
            <div className="weight-legend">
              <span><i className="weight-legend-dot" /> pesées</span>
              <span><i className="weight-legend-line" /> tendance (moyenne mobile 7 j)</span>
            </div>
          )}

          {/* Moyennes par semaine / mois */}
          {periodRows.length > 0 && (
            <div className="weight-periods">
              <h4 className="weight-subtitle">
                {view === 'week' ? 'Moyennes hebdomadaires' : 'Moyennes mensuelles'}
              </h4>
              {periodRows.map((p) => (
                <div key={p.day} className="weight-period-row">
                  <span className="weight-period-label">
                    {view === 'week'
                      ? `Sem. du ${fmtDayShort(p.day)}`
                      : parseISO(p.day).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                  </span>
                  <span className="weight-period-count">{p.count} pesée{p.count > 1 ? 's' : ''}</span>
                  <span className="weight-period-val">{fmtKg(p.avg)}</span>
                  <span className={`weight-period-delta ${deltaClass(p.delta, goal, p.avg)}`}>
                    {p.delta != null ? fmtDelta(p.delta) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Historique des pesées */}
          <div className="weight-history">
            <button
              type="button"
              className="weight-subtitle weight-history-toggle"
              onClick={() => setHistoryOpen((o) => !o)}
              aria-expanded={historyOpen}
            >
              <span>Historique des pesées ({historyDesc.length})</span>
              <span className={`weight-history-chevron${historyOpen ? ' is-open' : ''}`}>▾</span>
            </button>
            {historyOpen && historyDesc.slice(0, historyCount).map((e, i) => {
              const prev = historyDesc[i + 1];
              const d = prev ? e.weight - prev.weight : null;
              return (
                <div
                  key={e.day}
                  className={`weight-history-row${e.day === formDay ? ' is-selected' : ''}`}
                  onClick={() => handleEdit(e.day)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') handleEdit(e.day); }}
                  title="Modifier cette pesée"
                >
                  <span className="weight-history-day">{fmtDayLong(e.day)}</span>
                  <span className="weight-history-val">{fmtKg(e.weight)}</span>
                  <span className="weight-history-delta">{d != null ? fmtDelta(d) : ''}</span>
                  <button
                    type="button"
                    className="weight-history-del"
                    onClick={(ev) => { ev.stopPropagation(); handleDelete(e.day); }}
                    title="Supprimer"
                    aria-label="Supprimer la pesée"
                  >
                    🗑️
                  </button>
                </div>
              );
            })}
            {historyOpen && historyDesc.length > historyCount && (
              <button
                type="button"
                className="weight-link weight-link--block"
                onClick={() => setHistoryCount((c) => c + 30)}
              >
                Voir plus ({historyDesc.length - historyCount} restantes)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Couleur d'une variation : verte si elle va dans le sens de l'objectif
 * (ou, sans objectif, neutre). On ne juge pas une prise/perte de poids
 * sans savoir ce que l'utilisateur vise.
 */
function deltaClass(delta, goal, current) {
  if (delta == null || goal == null || current == null || Math.abs(delta) < 0.05) return '';
  const wantDown = goal < current;
  const good = wantDown ? delta < 0 : delta > 0;
  return good ? 'is-good' : 'is-bad';
}

export default WeightSection;
