import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { exerciseLibraryService } from '../services/api';
import { formatOneRepMax } from '../utils/oneRepMax';
import OneRepMaxBadge from '../components/OneRepMaxBadge';
import './ExerciseProgress.css';

/**
 * Page de progression d'un exercice — graphique du 1RM estimé au fil des
 * séances, filtrable par période (préréglages + dates personnalisées), et
 * détail des séries de chaque séance.
 */

const PRESETS = [
  { key: '90',    label: '90 j' },
  { key: '180',   label: '6 mois' },
  { key: '365',   label: '1 an' },
  { key: 'all',   label: 'Tout' },
  { key: 'custom',label: 'Personnalisé' },
];

const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatDateShort = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const formatDateFull = (dateStr) => {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

const ExerciseProgress = ({ user }) => {
  const { userId, exerciseName } = useParams();
  const navigate = useNavigate();
  const targetId = parseInt(userId, 10);
  const decodedName = decodeURIComponent(exerciseName);
  const isOwn = user && targetId === user.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const [preset, setPreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Bornes effectives (YYYY-MM-DD ou null = pas de borne) envoyées à l'API,
  // dérivées du préréglage choisi ou des dates personnalisées.
  const { effectiveFrom, effectiveTo } = useMemo(() => {
    if (preset === 'all') return { effectiveFrom: null, effectiveTo: null };
    if (preset === 'custom') {
      return { effectiveFrom: customFrom || null, effectiveTo: customTo || null };
    }
    const days = parseInt(preset, 10);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return { effectiveFrom: toISODate(from), effectiveTo: toISODate(to) };
  }, [preset, customFrom, customTo]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    exerciseLibraryService.getProgress(targetId, decodedName, effectiveFrom, effectiveTo)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur lors du chargement'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, decodedName, effectiveFrom, effectiveTo]);

  useEffect(() => { load(); }, [load]);

  const chartData = useMemo(() => {
    const sessions = data?.sessions || [];
    return sessions
      .filter((s) => s.best_one_rep_max != null)
      .map((s) => ({
        date: s.completed_at,
        label: formatDateShort(s.completed_at),
        orm: s.best_one_rep_max,
        weight: s.best_weight,
        reps: s.best_reps,
      }));
  }, [data]);

  const sessions = data?.sessions || [];
  const allTimeBest = data?.all_time_best;

  return (
    <div className="page-container">
      <button className="btn-back" onClick={() => navigate(-1)}>← Retour</button>

      <div className="page-header">
        <div>
          <h1 className="page-title">{decodedName}</h1>
          {!isOwn && data?.user && (
            <p className="card-subtitle" style={{ marginTop: '0.25rem' }}>
              Progression de {data.user.username}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="loading-screen">
          <div className="spinner"></div>
        </div>
      )}

      {error && !loading && <div className="form-error">{error}</div>}

      {!loading && !error && (
        <>
          {/* 1RM all-time */}
          <div className="card exprog-hero">
            {allTimeBest ? (
              <>
                <div className="exprog-hero-label">🏆 Meilleur 1RM estimé</div>
                <div className="exprog-hero-value">{formatOneRepMax(allTimeBest.one_rep_max)} kg</div>
                <div className="exprog-hero-sub">
                  Réalisé avec {allTimeBest.weight}kg × {allTimeBest.reps} reps
                  {' '}le {formatDateFull(allTimeBest.achieved_at)}
                </div>
              </>
            ) : (
              <div className="exprog-hero-sub">Pas encore de série avec poids enregistrée pour cet exercice.</div>
            )}
          </div>

          {/* Filtre de période */}
          <div className="card exprog-filters">
            <div className="exprog-preset-tabs">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`exprog-preset-tab${preset === p.key ? ' is-active' : ''}`}
                  onClick={() => setPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="exprog-custom-dates">
                <label className="exprog-date-field">
                  <span>Du</span>
                  <input
                    type="date"
                    className="form-input"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label className="exprog-date-field">
                  <span>Au</span>
                  <input
                    type="date"
                    className="form-input"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Graphique */}
          <div className="card">
            <h3 className="card-title mb-2">Évolution du 1RM estimé</h3>
            {chartData.length === 0 ? (
              <div className="exprog-chart-empty">Aucune donnée sur cette période.</div>
            ) : chartData.length === 1 ? (
              <div className="exprog-chart-empty">
                Une seule séance sur cette période ({formatOneRepMax(chartData[0].orm)} kg) —
                élargissez la période pour voir une courbe.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
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
                    domain={['dataMin - 5', 'dataMax + 5']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#242a28',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#dfeee4' }}
                    formatter={(v, name, props) => [
                      `${v} kg (${props.payload.weight}kg × ${props.payload.reps})`,
                      '1RM estimé',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="orm"
                    stroke="#ffd76a"
                    strokeWidth={2.2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Détail des séances */}
          <div className="card">
            <h3 className="card-title mb-2">Détail des séances</h3>
            {sessions.length === 0 ? (
              <p className="card-description">Aucune séance sur cette période.</p>
            ) : (
              <div className="exprog-sessions">
                {[...sessions].reverse().map((s) => (
                  <div key={s.workout_id} className="exprog-session">
                    <div className="exprog-session-header">
                      <div>
                        <div className="exprog-session-name">{s.session_name}</div>
                        <div className="exprog-session-date">{formatDateFull(s.completed_at)}</div>
                      </div>
                      {s.best_one_rep_max != null && (
                        <OneRepMaxBadge value={s.best_one_rep_max} />
                      )}
                    </div>
                    <div className="exprog-session-sets">
                      {s.sets.map((set, idx) => (
                        <span key={idx} className="exprog-set-chip">
                          {set.weight != null ? `${set.weight}kg × ` : ''}{set.reps} reps
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ExerciseProgress;