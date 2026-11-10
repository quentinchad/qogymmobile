import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { stepsService } from '../services/api';
import { useDailySteps } from '../hooks/useDailySteps';
import { todayISO } from '../utils/steps';
import { STEPS_FEATURE } from '../utils/featureFlags';
import './StepsSection.css';

/**
 * StepsSection — bloc "Pas quotidiens" de la page Profil.
 *
 *  - Réglage de l'objectif de pas (persisté via stepsService.setGoal).
 *  - Pas du jour + saisie manuelle de secours (via useDailySteps).
 *  - Historique : graphique des 7 / 30 / 90 derniers jours, avec une ligne
 *    de référence pour l'objectif.
 *
 * Le composant est autonome (son propre chargement de l'historique) pour ne
 * pas alourdir Profile.js et rester facilement déplaçable.
 */

const RANGES = [
  { key: 7,  label: '7 j'  },
  { key: 30, label: '30 j' },
  { key: 90, label: '90 j' },
];

const shiftISO = (iso, deltaDays) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const fmtShort = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}/${m}`;
};

const StepsSection = () => {
  // Fonctionnalité pas désactivée pour le moment (cf. utils/featureFlags).
  if (!STEPS_FEATURE) return null;

  return <StepsSectionInner />;
};

const StepsSectionInner = () => {
  const { steps, goal, source, bridgePresent, loading, migrationNeeded, setManualSteps, saveGoal, refresh } = useDailySteps();

  const [goalDraft, setGoalDraft] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalMsg, setGoalMsg] = useState(null);

  const [rangeDays, setRangeDays] = useState(30);
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(true);

  const [manualDraft, setManualDraft] = useState('');
  const [manualEditing, setManualEditing] = useState(false);

  // Synchronise l'input objectif avec la valeur chargée.
  useEffect(() => {
    setGoalDraft(goal != null ? String(goal) : '');
  }, [goal]);

  const loadHistory = useCallback(async (days) => {
    setHistLoading(true);
    try {
      const to = todayISO();
      const from = shiftISO(to, -(days - 1));
      const resp = await stepsService.getRange(from, to);
      const byDay = {};
      (resp.data.days || []).forEach((r) => { byDay[r.day] = r.steps; });
      // Remplit tous les jours de l'intervalle (0 si pas de donnée) pour un
      // graphique continu.
      const arr = [];
      for (let i = 0; i < days; i++) {
        const iso = shiftISO(from, i);
        arr.push({ day: iso, label: fmtShort(iso), steps: byDay[iso] || 0 });
      }
      setHistory(arr);
    } catch (_) {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(rangeDays); }, [rangeDays, loadHistory, steps]);

  const handleSaveGoal = async () => {
    setGoalSaving(true);
    setGoalMsg(null);
    const trimmed = goalDraft.trim();
    const ok = await saveGoal(trimmed === '' ? null : trimmed);
    setGoalSaving(false);
    setGoalMsg(ok ? 'Objectif enregistré' : 'Erreur lors de l\'enregistrement');
    setTimeout(() => setGoalMsg(null), 2500);
  };

  const commitManual = async () => {
    await setManualSteps(manualDraft);
    setManualEditing(false);
    loadHistory(rangeDays);
  };

  const stats = useMemo(() => {
    if (history.length === 0) return null;
    const withData = history.filter(h => h.steps > 0);
    const total = history.reduce((s, h) => s + h.steps, 0);
    const avg = withData.length ? Math.round(total / withData.length) : 0;
    const best = history.reduce((m, h) => Math.max(m, h.steps), 0);
    return { avg, best, total };
  }, [history]);

  const value = steps == null ? 0 : steps;
  const hasGoal = goal != null && goal > 0;
  const isAuto = typeof source === 'string' && source.indexOf('native') === 0;

  // Migration BDD pas encore exécutée : message explicite (utile au dev /
  // admin), pas de graphique vide ni de saisie qui échouerait.
  if (migrationNeeded) {
    return (
      <div className="card mb-2 steps-section">
        <h3 className="card-title">👟 Pas quotidiens</h3>
        <p className="card-description">
          Fonctionnalité bientôt disponible. La mise à jour de la base de
          données (migration <code>migrations_steps.sql</code>) doit être
          exécutée pour activer le suivi des pas.
        </p>
      </div>
    );
  }

  return (
    <div className="card mb-2 steps-section">
      <h3 className="card-title">👟 Pas quotidiens</h3>
      <p className="card-description">
        {bridgePresent
          ? 'Tes pas sont synchronisés automatiquement depuis ton téléphone.'
          : 'Les pas ne sont pas encore synchronisés automatiquement. Tu peux les saisir manuellement en attendant.'}
      </p>

      {/* Pas du jour */}
      <div className="steps-today">
        <div className="steps-today-value">
          {loading && steps == null ? '—' : value.toLocaleString('fr-FR')}
          <span className="steps-today-unit"> pas aujourd'hui</span>
        </div>
        {source && (
          <span className={`steps-source-badge steps-source-badge--${isAuto ? 'native' : 'manual'}`}>
            {isAuto ? 'auto' : 'manuel'}
          </span>
        )}
      </div>

      {manualEditing ? (
        <div className="steps-manual-row">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            className="steps-input"
            value={manualDraft}
            onChange={(e) => setManualDraft(e.target.value)}
            placeholder="Nombre de pas"
            autoFocus
          />
          <button type="button" className="btn btn-primary btn-small" onClick={commitManual}>OK</button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setManualEditing(false)}
          >
            Annuler
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="steps-manual-trigger"
          onClick={() => { setManualDraft(value ? String(value) : ''); setManualEditing(true); }}
        >
          {isAuto ? 'Corriger manuellement' : 'Saisir / mettre à jour mes pas'}
        </button>
      )}

      {/* Objectif */}
      <div className="steps-goal-row">
        <label className="target-label">Objectif quotidien</label>
        <input
          type="number"
          inputMode="numeric"
          min="0" max="200000" step="500"
          className="kcal-target-input"
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value)}
          placeholder="Ex. 8000"
          disabled={goalSaving}
        />
        <span className="kcal-target-unit">pas</span>
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={handleSaveGoal}
          disabled={goalSaving}
        >
          {goalSaving ? '…' : 'Enregistrer'}
        </button>
      </div>
      {goalMsg && <div className="steps-goal-msg">{goalMsg}</div>}

      {/* Historique */}
      <div className="steps-history-head">
        <h4 className="steps-history-title">Historique</h4>
        <div className="steps-range-tabs">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              className={`steps-range-tab${rangeDays === r.key ? ' is-active' : ''}`}
              onClick={() => setRangeDays(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <div className="steps-stats-row">
          <div className="steps-stat">
            <div className="steps-stat-val">{stats.avg.toLocaleString('fr-FR')}</div>
            <div className="steps-stat-lbl">Moyenne / jour actif</div>
          </div>
          <div className="steps-stat">
            <div className="steps-stat-val">{stats.best.toLocaleString('fr-FR')}</div>
            <div className="steps-stat-lbl">Record</div>
          </div>
          <div className="steps-stat">
            <div className="steps-stat-val">{stats.total.toLocaleString('fr-FR')}</div>
            <div className="steps-stat-lbl">Total période</div>
          </div>
        </div>
      )}

      <div className="steps-chart">
        {histLoading ? (
          <div className="steps-chart-loading">Chargement…</div>
        ) : history.length === 0 ? (
          <div className="steps-chart-empty">Aucune donnée sur la période.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9aa79a' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9aa79a' }}
                width={44}
                tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v}
              />
              <Tooltip
                contentStyle={{
                  background: '#242a28',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#dfeee4' }}
                formatter={(v) => [`${Number(v).toLocaleString('fr-FR')} pas`, '']}
              />
              {hasGoal && (
                <ReferenceLine
                  y={goal}
                  stroke="#2e7d50"
                  strokeDasharray="5 4"
                  label={{ value: 'Objectif', fill: '#9aa79a', fontSize: 10, position: 'insideTopRight' }}
                />
              )}
              <Line
                type="monotone"
                dataKey="steps"
                stroke="#2ecc71"
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default StepsSection;
