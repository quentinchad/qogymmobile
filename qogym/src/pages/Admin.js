import React, { useState, useEffect } from 'react';
import { adminService, sessionService, remindersService, monthlyReportService, unverifiedCleanupService } from '../services/api';
import './Admin.css';

const Admin = ({ user }) => {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [qojimSessions, setQojimSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stats');
  const [newTypeName, setNewTypeName] = useState('');
  const [reminderStats, setReminderStats]   = useState(null);
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderResults, setReminderResults] = useState(null);

  // Comptes non confirmés (nettoyage)
  const [cleanupStats, setCleanupStats] = useState(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);

  // Rapports mensuels
  const [reportSending, setReportSending] = useState(false);
  const [reportResults, setReportResults] = useState(null);

  const handleGenerateReports = async () => {
    if (!window.confirm(
      "Générer les rapports mensuels pour le mois précédent ?\n\n" +
      "Une notification sera créée et un email envoyé à chaque utilisateur " +
      "ayant au moins un entraînement enregistré le mois ciblé. " +
      "Les utilisateurs déjà notifiés ce mois seront ignorés."
    )) return;

    setReportSending(true);
    setReportResults(null);
    try {
      const res = await monthlyReportService.generate();
      setReportResults(res.data);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la génération');
    } finally {
      setReportSending(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, usersRes, typesRes, sessionsRes] = await Promise.all([
        adminService.getStats(),
        adminService.getUsers(),
        adminService.getSessionTypes(),
        adminService.getQojimSessions()
      ]);

      setStats(statsRes.data.stats);
      setUsers(usersRes.data.users);
      setSessionTypes(typesRes.data.session_types);
      setQojimSessions(sessionsRes.data.sessions);
    } catch (err) {
      console.error('Erreur lors du chargement des données admin', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateType = async (e) => {
    e.preventDefault();
    if (!newTypeName.trim()) return;

    try {
      await adminService.createSessionType(newTypeName);
      setNewTypeName('');
      loadData();
    } catch (err) {
      alert('Erreur lors de la création du type');
    }
  };

  const handleDeleteType = async (typeId) => {
    if (!window.confirm('Supprimer ce type de séance ?')) return;

    try {
      await adminService.deleteSessionType(typeId);
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  };

  const loadReminderStats = async () => {
    try {
      const res = await remindersService.getStats();
      setReminderStats(res.data);
    } catch (err) {
      console.error('Erreur stats relances:', err);
    }
  };

  const handleSendReminders = async (type) => {
    const labels = {
      all: 'tous les utilisateurs concernés',
      inactive: 'les utilisateurs inactifs (+7 jours)',
      never_active: 'les utilisateurs jamais actifs',
    };
    if (!window.confirm(`Envoyer les relances à ${labels[type]} ?`)) return;

    setReminderSending(true);
    setReminderResults(null);
    try {
      const res = await remindersService.send(type);
      setReminderResults(res.data);
      // Rafraîchir les stats
      loadReminderStats();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de l\'envoi');
    } finally {
      setReminderSending(false);
    }
  };

  const loadCleanupStats = async () => {
    try {
      const res = await unverifiedCleanupService.getStats();
      setCleanupStats(res.data);
    } catch (err) {
      console.error('Erreur stats nettoyage comptes non confirmés:', err);
    }
  };

  const handleRunCleanup = async () => {
    if (!window.confirm(
      `Supprimer les ${cleanupStats?.expired_unverified ?? ''} compte(s) non confirmé(s) et expiré(s) ?\n\n` +
      "Cette action est irréversible : les utilisateurs concernés devront se réinscrire."
    )) return;

    setCleanupRunning(true);
    setCleanupResult(null);
    try {
      const res = await unverifiedCleanupService.run();
      setCleanupResult(res.data);
      loadCleanupStats();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du nettoyage');
    } finally {
      setCleanupRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-screen">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">⚙️ Administration</h1>
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Statistiques
        </button>
        <button
          className={`tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Utilisateurs
        </button>
        <button
          className={`tab ${activeTab === 'types' ? 'active' : ''}`}
          onClick={() => setActiveTab('types')}
        >
          Types de séances
        </button>
        <button
          className={`tab ${activeTab === 'qojim' ? 'active' : ''}`}
          onClick={() => setActiveTab('qojim')}
        >
          Séances Qojim
        </button>
        <button
          className={`tab ${activeTab === 'reminders' ? 'active' : ''}`}
          onClick={() => { setActiveTab('reminders'); loadReminderStats(); }}
        >
          Relances
        </button>
        <button
          className={`tab ${activeTab === 'unverified' ? 'active' : ''}`}
          onClick={() => { setActiveTab('unverified'); loadCleanupStats(); }}
        >
          Comptes non confirmés
        </button>
        <button
          className={`tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          Rapports mensuels
        </button>
      </div>

      {/* Statistiques */}
      {activeTab === 'stats' && stats && (
        <div className="card">
          <h3 className="card-title mb-2">Vue d'ensemble</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.total_users}</div>
              <div className="stat-label">Utilisateurs</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_qojim_sessions}</div>
              <div className="stat-label">Séances Qojim</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_completed_workouts}</div>
              <div className="stat-label">Entraînements</div>
            </div>
          </div>
        </div>
      )}

      {/* Utilisateurs */}
      {activeTab === 'users' && (
        <div className="card">
          <h3 className="card-title mb-2">Utilisateurs ({users.length})</h3>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom d'utilisateur</th>
                  <th>Email</th>
                  <th>Entraînements</th>
                  <th>Inscrit le</th>
                  <th>Rôle</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>{u.total_workouts}</td>
                    <td>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                      {u.is_admin === '1' ? (
                        <span className="badge badge-info">Admin</span>
                      ) : (
                        <span className="badge badge-secondary">Utilisateur</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Types de séances */}
      {activeTab === 'types' && (
        <>
          <div className="card mb-2">
            <h3 className="card-title mb-2">Créer un type de séance</h3>
            <form onSubmit={handleCreateType} className="flex gap-2">
              <input
                type="text"
                className="form-input"
                placeholder="Nom du type (ex: Yoga)"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                Créer
              </button>
            </form>
          </div>

          <div className="card">
            <h3 className="card-title mb-2">Types existants</h3>
            <div className="types-list">
              {sessionTypes.map((type) => (
                <div key={type.id} className="type-item">
                  <div>
                    <strong>{type.name}</strong>
                    <span className="text-secondary ml-1">
                      ({type.usage_count} séance{type.usage_count > 1 ? 's' : ''})
                    </span>
                  </div>
                  {type.usage_count === '0' && (
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleDeleteType(type.id)}
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Séances Qojim */}
      {activeTab === 'qojim' && (
        <div className="card">
          <h3 className="card-title mb-2">Séances Qojim ({qojimSessions.length})</h3>
          <div className="qojim-list">
            {qojimSessions.map((session) => (
              <div key={session.id} className="qojim-item">
                <div className="flex-between" style={{width: '100%'}}>
                  <div>
                    <strong>{session.name}</strong>
                    <p className="text-secondary">
                      {session.session_type_name} • {session.users_count} utilisateur
                      {session.users_count > 1 ? 's' : ''}
                    </p>
                    {session.is_archived === '1' && (
                      <span className="badge badge-warning">Archivée</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="btn btn-outline btn-small"
                      onClick={() => window.location.href = `/create-session/${session.id}`}
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        const isArchived = session.is_archived === '1' || session.is_archived === 1;
                        if (!window.confirm(`${isArchived ? 'Désarchiver' : 'Archiver'} cette séance ?`)) return;
                        try {
                          await sessionService.update({
                            id: session.id,
                            is_archived: isArchived ? 0 : 1
                          });
                          // Mettre à jour l'état localement
                          setQojimSessions(qojimSessions.map(s =>
                            s.id === session.id ? { ...s, is_archived: isArchived ? 0 : 1 } : s
                          ));
                        } catch (err) {
                          console.error('Erreur archivage:', err);
                          alert('Erreur lors de l\'archivage');
                        }
                      }}
                    >
                      {session.is_archived === '1' || session.is_archived === 1 ? '📂 Désarchiver' : '📁 Archiver'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {qojimSessions.length === 0 && (
            <p className="text-secondary text-center">Aucune séance Qojim</p>
          )}
        </div>
      )}

      {/* Relances email */}
      {activeTab === 'reminders' && (
        <div>
          {/* Statistiques */}
          <div className="card mb-2">
            <h3 className="card-title mb-2">Utilisateurs à relancer</h3>
            {reminderStats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{reminderStats.inactive}</div>
                  <div className="stat-label">Inactifs depuis 7+ jours</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{reminderStats.never_active}</div>
                  <div className="stat-label">Jamais entraînés</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{(reminderStats.inactive || 0) + (reminderStats.never_active || 0)}</div>
                  <div className="stat-label">Total à relancer</div>
                </div>
              </div>
            ) : (
              <p className="text-secondary">Chargement des statistiques...</p>
            )}
          </div>

          {/* Boutons d'envoi */}
          <div className="card mb-2">
            <h3 className="card-title mb-2">Envoyer les relances</h3>
            <p className="text-secondary" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
              Les emails sont envoyés à tous les utilisateurs concernés selon leur catégorie.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-color)', borderRadius: '8px' }}>
                <div>
                  <strong>Inactifs (+7 jours)</strong>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Utilisateurs qui ont déjà fait un entraînement mais pas depuis 7+ jours
                  </p>
                </div>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => handleSendReminders('inactive')}
                  disabled={reminderSending}
                >
                  Envoyer
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-color)', borderRadius: '8px' }}>
                <div>
                  <strong>Jamais actifs</strong>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Utilisateurs inscrits mais n'ayant jamais démarré un entraînement
                  </p>
                </div>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => handleSendReminders('never_active')}
                  disabled={reminderSending}
                >
                  Envoyer
                </button>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => handleSendReminders('all')}
                disabled={reminderSending}
                style={{ marginTop: '0.5rem' }}
              >
                {reminderSending ? 'Envoi en cours...' : 'Envoyer à tous'}
              </button>
            </div>
          </div>

          {/* Résultats */}
          {reminderResults && (
            <div className="card">
              <h3 className="card-title mb-2">
                Résultats — {reminderResults.sent} envoyé{reminderResults.sent > 1 ? 's' : ''}
                {reminderResults.failed > 0 && `, ${reminderResults.failed} échec${reminderResults.failed > 1 ? 's' : ''}`}
              </h3>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {reminderResults.results.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.4rem 0',
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.875rem'
                  }}>
                    <span>{r.success ? '✅' : '❌'}</span>
                    <span style={{ fontWeight: 600 }}>{r.username}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      — {r.type === 'inactive' ? 'inactif' : 'jamais actif'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comptes non confirmés */}
      {activeTab === 'unverified' && (
        <div>
          <div className="card mb-2">
            <h3 className="card-title mb-2">Comptes à supprimer</h3>
            <p className="text-secondary" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
              Comptes créés il y a plus de 24h dont l'email n'a jamais été confirmé.
              Ils ne peuvent pas se connecter tant qu'ils ne le sont pas, donc les
              supprimer ne fait perdre aucune donnée (aucune séance/workout n'a pu
              être créé sur ces comptes).
            </p>
            {cleanupStats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{cleanupStats.expired_unverified}</div>
                  <div className="stat-label">Comptes expirés non confirmés</div>
                </div>
              </div>
            ) : (
              <p className="text-secondary">Chargement des statistiques...</p>
            )}
          </div>

          <div className="card mb-2">
            <button
              className="btn btn-primary"
              onClick={handleRunCleanup}
              disabled={cleanupRunning || !cleanupStats?.expired_unverified}
            >
              {cleanupRunning
                ? 'Suppression en cours...'
                : `Supprimer les comptes expirés${cleanupStats?.expired_unverified ? ` (${cleanupStats.expired_unverified})` : ''}`}
            </button>
          </div>

          {cleanupResult && (
            <div className="card">
              <h3 className="card-title mb-2">
                {cleanupResult.deleted} compte{cleanupResult.deleted > 1 ? 's' : ''} supprimé{cleanupResult.deleted > 1 ? 's' : ''}
              </h3>
            </div>
          )}
        </div>
      )}

      {/* Rapports mensuels */}
      {activeTab === 'reports' && (() => {
        const now = new Date();
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
          'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        const targetLabel = `${monthNames[prev.getMonth()]} ${prev.getFullYear()}`;
        return (
          <div className="card">
            <h3 className="card-title mb-2">Génération des rapports</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Cette action génère le rapport mensuel pour <strong>{targetLabel}</strong>.
              Une notification sera créée pour chaque utilisateur ayant au moins
              un entraînement enregistré sur ce mois, et un email leur sera envoyé.
              Les utilisateurs déjà notifiés pour ce mois seront ignorés (l'action
              est donc safe à relancer).
            </p>
            <button
              className="btn btn-primary"
              onClick={handleGenerateReports}
              disabled={reportSending}
            >
              {reportSending ? 'Génération en cours…' : `Générer les rapports — ${targetLabel}`}
            </button>

            {reportResults && (
              <div style={{ marginTop: '1.25rem', padding: '0.9rem', background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
                  Résultats
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.92rem', lineHeight: 1.6 }}>
                  <li>Période : {monthNames[reportResults.period.month - 1]} {reportResults.period.year}</li>
                  <li>Utilisateurs éligibles : <strong>{reportResults.eligible}</strong></li>
                  <li>Notifications créées : <strong>{reportResults.created}</strong></li>
                  <li>Déjà notifiés (ignorés) : {reportResults.skipped}</li>
                  <li>Emails envoyés : <strong>{reportResults.emailed}</strong>{reportResults.email_errors > 0 && ` (${reportResults.email_errors} échec${reportResults.email_errors > 1 ? 's' : ''})`}</li>
                </ul>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default Admin;