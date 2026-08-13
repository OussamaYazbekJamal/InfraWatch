import React, { useState, useEffect, useCallback } from 'react';
import { getNotifications, markNotificationRead, getMyReportHistory } from '../services/api';
import '../styles/admin.css';

const TYPE_LABELS = {
  report_update: '📋 Report Update',
};

const STATUS_COLORS = { pending: '#f59e0b', reviewed: '#3b82f6', resolved: '#10b981' };

function NotificationsList() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getNotifications();
      setNotifications(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      await markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      // Tells the Navbar's unread-count badge to recheck immediately,
      // rather than waiting for its own 30s poll or a route change —
      // matters here specifically because we're staying on this same page.
      window.dispatchEvent(new Event('notifications-updated'));
    } catch {
      // Fail-soft: if marking-as-read fails, the notification stays visible
      // as unread — worst case the person clicks it again, no data lost.
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const [search, setSearch] = useState('');
  const visibleNotifications = search.trim()
    ? notifications.filter(n => n.message.toLowerCase().includes(search.trim().toLowerCase()))
    : notifications;

  return (
    <div>
      <h2 style={{ marginBottom: '1.25rem' }}>
        🔔 Notifications {unreadCount > 0 && <span className="pill pill-limited">{unreadCount} unread</span>}
      </h2>

      {error && <div className="feedback-err" style={{ marginBottom: '1rem' }}>{error}</div>}

      {notifications.length > 0 && (
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search notifications…"
          style={{ width: '100%', padding: '.6rem .85rem', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--gray-300)', fontSize: '.85rem', marginBottom: '1rem' }}/>
      )}

      {loading ? (
        <div className="spinner-wrap"><div className="spinner"/></div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">No notifications yet.</div>
      ) : visibleNotifications.length === 0 ? (
        <div className="empty-state">No notifications match "{search}".</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {visibleNotifications.map(n => (
            <div key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              style={{
                padding: '.85rem 1rem',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: n.read ? '#fff' : '#f0fdf4',
                cursor: n.read ? 'default' : 'pointer',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem' }}>
                <div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#64748b', marginBottom: '.2rem' }}>
                    {TYPE_LABELS[n.type] || n.type}
                  </div>
                  <div>{n.message}</div>
                </div>
                {!n.read && <span className="pill pill-available" style={{ whiteSpace: 'nowrap' }}>New</span>}
              </div>
              <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: '.4rem' }}>
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Lets a citizen track their own submitted reports and current status —
// a separate view from staff/lead's jurisdiction-wide manage list, scoped
// server-side to the logged-in user's own reports only (GET /reports/mine).
function MyReportsList() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getMyReportHistory();
      setReports(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load your reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [search, setSearch] = useState('');
  const visibleReports = search.trim()
    ? reports.filter(r => {
        const q = search.trim().toLowerCase();
        return (r.location_name || r.district || '').toLowerCase().includes(q)
          || (r.category || '').toLowerCase().includes(q)
          || (r.problem_type || '').toLowerCase().includes(q)
          || (r.status || '').toLowerCase().includes(q)
          || new Date(r.created_at).toLocaleDateString().toLowerCase().includes(q);
      })
    : reports;

  return (
    <div>
      <h2 style={{ marginBottom: '1.25rem' }}>📄 My Reports</h2>
      {error && <div className="feedback-err" style={{ marginBottom: '1rem' }}>{error}</div>}

      {reports.length > 0 && (
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by location, category, type, status, or date (e.g. 8/3/2026)…"
          style={{ width: '100%', padding: '.6rem .85rem', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--gray-300)', fontSize: '.85rem', marginBottom: '1rem' }}/>
      )}

      {loading ? (
        <div className="spinner-wrap"><div className="spinner"/></div>
      ) : reports.length === 0 ? (
        <div className="empty-state">You haven't submitted any reports yet.</div>
      ) : visibleReports.length === 0 ? (
        <div className="empty-state">No reports match "{search}".</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {visibleReports.map(r => (
            <div key={r.id} style={{ padding: '.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.location_name || r.district || 'Unnamed location'}</div>
                  <div style={{ fontSize: '.85rem', color: '#64748b', textTransform: 'capitalize' }}>
                    {r.category} · {r.problem_type}
                  </div>
                </div>
                <span className="pill" style={{ background: `${STATUS_COLORS[r.status] || '#94a3b8'}22`, color: STATUS_COLORS[r.status] || '#64748b', whiteSpace: 'nowrap' }}>
                  {r.status}
                </span>
              </div>
              <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: '.4rem' }}>
                Submitted {new Date(r.created_at).toLocaleDateString()} · {r.confirmation_count ?? 0} confirmation{r.confirmation_count === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = ['notifications', 'reports'];

export default function Notifications() {
  const [tab, setTab] = useState('notifications');

  return (
    <div style={{ maxWidth: '720px', margin: '2rem auto', padding: '0 1rem' }}>
      <div className="panel">
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.25rem' }}>
          {TABS.map(t => (
            <button key={t} type="button"
              className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t)}>
              {t === 'notifications' ? '🔔 Notifications' : '📄 My Reports'}
            </button>
          ))}
        </div>

        {tab === 'notifications' ? <NotificationsList/> : <MyReportsList/>}
      </div>
    </div>
  );
}