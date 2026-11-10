import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { monthlyReportService } from '../services/api';
import './MonthlyReport.css';

const MONTH_NAMES = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DOW_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const formatDuration = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h${String(m).padStart(2, '0')}`;
};
const formatVolume = (kg) => {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg)} kg`;
};

/** Calcule le pourcentage de variation entre deux valeurs.
 *  Retourne null si la base est 0 (variation indéfinie). */
const pctChange = (current, prev) => {
  if (prev === undefined || prev === null) return null;
  if (prev === 0) return current > 0 ? 100 : null;
  return Math.round(((current - prev) / prev) * 100);
};

/** Petit composant "delta" : flèche + pourcentage coloré. */
const Delta = ({ current, previous }) => {
  if (previous === undefined || previous === null) {
    return <span className="mr-delta mr-delta--neutral">—</span>;
  }
  const diff = pctChange(current, previous);
  if (diff === null) return <span className="mr-delta mr-delta--neutral">—</span>;
  if (diff === 0)    return <span className="mr-delta mr-delta--neutral">±0%</span>;
  const positive = diff > 0;
  return (
    <span className={`mr-delta ${positive ? 'mr-delta--up' : 'mr-delta--down'}`}>
      {positive ? '▲' : '▼'} {Math.abs(diff)}%
    </span>
  );
};

/** Mini carte KPI. */
const KpiCard = ({ label, value, prevValue }) => (
  <div className="mr-kpi">
    <div className="mr-kpi-value">{value}</div>
    <div className="mr-kpi-label">{label}</div>
    <div className="mr-kpi-delta">
      <Delta
        current={typeof value === 'number' ? value : 0}
        previous={prevValue}
      />
      <span className="mr-kpi-prev">vs mois précédent</span>
    </div>
  </div>
);

/** Calendrier du mois : grille de cases, jours d'entraînement colorés. */
const TrainingCalendar = ({ year, month, trainingDays }) => {
  // trainingDays = ["2026-04-03", "2026-04-08", ...]
  const trainingSet = useMemo(() => new Set(trainingDays || []), [trainingDays]);

  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  // getDay() : 0 = dim, 1 = lun … on remappe pour que lundi = 0
  const startDow = (firstDay.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ blank: true, key: `b-${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, trained: trainingSet.has(iso), key: iso });
  }

  return (
    <div className="mr-cal">
      {DOW_NAMES.map(n => (
        <div key={n} className="mr-cal-dow">{n}</div>
      ))}
      {cells.map(c =>
        c.blank
          ? <div key={c.key} className="mr-cal-cell mr-cal-cell--blank" />
          : (
            <div
              key={c.key}
              className={`mr-cal-cell ${c.trained ? 'mr-cal-cell--trained' : ''}`}
              title={c.trained ? 'Entraînement effectué' : ''}
            >
              <span className="mr-cal-day">{c.day}</span>
            </div>
          )
      )}
    </div>
  );
};

const MonthlyReport = () => {
  const { year, month } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading]       = useState(true);
  const [error,   setError]         = useState('');
  const [report,  setReport]        = useState(null); // { current, previous, has_data }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    monthlyReportService
      .getDetail(year, month)
      .then(res => { if (alive) setReport(res.data); })
      .catch(err => { if (alive) setError(err.response?.data?.error || 'Erreur lors du chargement'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, month]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-screen"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="form-error">{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate('/profile')}>← Retour au profil</button>
      </div>
    );
  }

  if (!report?.has_data) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Rapport · {MONTH_NAMES[Number(month)]} {year}</h1>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <p className="empty-state-text">Aucun entraînement sur cette période.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/profile')}>← Retour au profil</button>
        </div>
      </div>
    );
  }

  const { current, previous } = report;
  const k = current.kpis;
  const p = previous?.kpis;

  // Données pour le graphe "jours de la semaine"
  const dowData = (current.by_day_of_week || []).map((v, i) => ({
    day: DOW_NAMES[i],
    workouts: v,
  }));

  // Données pour le graphe d'évolution hebdomadaire (volume)
  const weekData = (current.by_week || []).map((w, i) => ({
    label: `S${i + 1}`,
    volume: Math.round(w.volume_kg),
    workouts: w.workouts,
  }));

  return (
    <div className="page-container mr-container">
      <div className="page-header">
        <h1 className="page-title">Rapport · {MONTH_NAMES[Number(month)]} {year}</h1>
        <button className="btn btn-secondary" onClick={() => navigate('/profile')}>
          ← Profil
        </button>
      </div>

      {/* ---- KPIs principaux ---- */}
      <div className="mr-kpi-grid">
        <KpiCard label="Entraînements"   value={k.workouts_count}                       prevValue={p?.workouts_count} />
        <KpiCard label="Séries"          value={k.sets_count}                           prevValue={p?.sets_count} />
        <KpiCard label="Répétitions"     value={k.total_reps}                           prevValue={p?.total_reps} />
        <KpiCard label="Volume"          value={formatVolume(k.total_volume_kg)}        prevValue={p ? Math.round(p.total_volume_kg) : undefined} />
        <KpiCard label="Temps total"     value={formatDuration(k.total_seconds)}        prevValue={p?.total_seconds} />
        <KpiCard label="Plus longue série" value={`${k.longest_streak} j`}              prevValue={p?.longest_streak} />
      </div>

      {/* ---- Calendrier ---- */}
      <div className="card mr-card">
        <h3 className="card-title">Calendrier d'entraînement</h3>
        <TrainingCalendar
          year={Number(year)}
          month={Number(month)}
          trainingDays={current.training_days}
        />
      </div>

      {/* ---- Top exercices ---- */}
      {current.top_exercises?.length > 0 && (
        <div className="card mr-card">
          <h3 className="card-title">Exercices favoris</h3>
          <div className="mr-chart">
            <ResponsiveContainer width="100%" height={Math.max(180, current.top_exercises.length * 38)}>
              <BarChart
                data={[...current.top_exercises].reverse()}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 5, bottom: 5 }}
              >
                <XAxis type="number" stroke="var(--text-secondary, #9aa79a)" />
                <YAxis dataKey="name" type="category" stroke="var(--text-secondary, #9aa79a)" width={120} />
                <Tooltip
                  contentStyle={{ background: '#1f2624', border: '1px solid #2e7d50', borderRadius: 8 }}
                  formatter={(value, name) => [value, name === 'sets' ? 'Séries' : name]}
                />
                <Bar dataKey="sets" fill="#2ecc71" radius={[0, 4, 4, 0]} name="Séries" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ---- Évolution hebdomadaire ---- */}
      {weekData.length > 0 && (
        <div className="card mr-card">
          <h3 className="card-title">Volume soulevé par semaine</h3>
          <div className="mr-chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={weekData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" stroke="var(--text-secondary, #9aa79a)" />
                <YAxis stroke="var(--text-secondary, #9aa79a)" />
                <Tooltip
                  contentStyle={{ background: '#1f2624', border: '1px solid #2e7d50', borderRadius: 8 }}
                  formatter={(v) => [`${v} kg`, 'Volume']}
                />
                <Line type="monotone" dataKey="volume" stroke="#2ecc71" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ---- Distribution par jour de la semaine ---- */}
      <div className="card mr-card">
        <h3 className="card-title">Quels jours t'entraînes-tu ?</h3>
        <div className="mr-chart">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dowData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="day" stroke="var(--text-secondary, #9aa79a)" />
              <YAxis allowDecimals={false} stroke="var(--text-secondary, #9aa79a)" />
              <Tooltip
                contentStyle={{ background: '#1f2624', border: '1px solid #2e7d50', borderRadius: 8 }}
              />
              <Bar dataKey="workouts" fill="#2ecc71" radius={[4, 4, 0, 0]} name="Entraînements" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ---- Records personnels ---- */}
      {current.personal_records?.length > 0 && (
        <div className="card mr-card">
          <h3 className="card-title">Records personnels battus</h3>
          <ul className="mr-pr-list">
            {current.personal_records.map((pr) => (
              <li key={pr.name} className="mr-pr-item">
                <span className="mr-pr-name">{pr.name}</span>
                <span className="mr-pr-values">
                  <strong>{pr.max_weight} kg</strong>
                  {pr.previous_max !== null && (
                    <span className="mr-pr-prev"> (avant : {pr.previous_max} kg)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Distribution par type de séance ---- */}
      {current.by_session_type?.length > 0 && (
        <div className="card mr-card">
          <h3 className="card-title">Types de séances</h3>
          <div className="mr-types">
            {current.by_session_type.map((t) => (
              <div key={t.name} className="mr-type-row">
                <span className="mr-type-name">{t.name}</span>
                <span className="mr-type-count">{t.workouts} séance{t.workouts > 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthlyReport;