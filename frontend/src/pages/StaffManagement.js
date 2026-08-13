import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getOrgStaff, createOrgStaff, revokeOrgStaff, restoreOrgStaff, getStaffActivity, getOrgLeadReports } from '../services/api';
import TempPasswordModal from '../components/TempPasswordModal';
import '../styles/admin.css';

const ACTION_LABELS = {
  create: '➕ Created',
  edit:   '✏️ Edited',
  claim:  '🏳️ Claimed',
  delete: '🗑️ Deleted',
};

const ENTITY_LABELS = {
  fuel_stations:       'Fuel Station',
  government_offices:  'Government Office',
  transport_routes:    'Transport Route',
  outage_data:         'Outage Record',
  health_facilities:   'Health Facility',
};

const STATUS_PILL = {
  pending:  'pill-pending',
  reviewed: 'pill-reviewed',
  resolved: 'pill-available',
};

const SEVERITY_PILL = {
  low:      'pill-available',
  medium:   'pill-pending',
  high:     'pill-closed',
  critical: 'pill-closed',
};

function StaffMembersPanel() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '' });
  const [error, setError] = useState('');
  const [tempCred, setTempCred] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await getOrgStaff(); setStaff(data); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await createOrgStaff(form);
      setStaff(p => [{ ...data.staff, is_active: true }, ...p]);
      setTempCred({ email: data.staff.email, tempPassword: data.temp_password });
      setForm({ name: '', email: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create staff account');
    }
  };

  const revoke = async (id) => {
    if (!window.confirm('Revoke this staff member\'s access?')) return;
    await revokeOrgStaff(id);
    setStaff(p => p.map(s => s.id===id ? { ...s, is_active: false } : s));
  };

  const restore = async (id) => {
    await restoreOrgStaff(id);
    setStaff(p => p.map(s => s.id===id ? { ...s, is_active: true } : s));
  };

  return (
    <>
      <div className="panel">
        <h2 style={{marginBottom:'.4rem'}}>➕ Add Staff Member</h2>
        <p style={{color:'#64748b', fontSize:'.85rem', marginBottom:'1.25rem'}}>
          A temporary password is generated automatically and emailed directly to the staff member.
        </p>
        {error && <div className="feedback-err" style={{marginBottom:'1rem'}}>{error}</div>}
        <form onSubmit={submit} style={{display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'flex-end'}}>
          <div className="field" style={{minWidth:'220px', flex:'1 1 220px'}}>
            <label>Name</label>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Jane Doe" required />
          </div>
          <div className="field" style={{minWidth:'220px', flex:'1 1 220px'}}>
            <label>Email</label>
            <input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="jane@example.com" required />
          </div>
          <button className="btn btn-primary" type="submit">+ Add Staff</button>
        </form>
      </div>

      {loading ? (
        <div className="spinner-wrap"><div className="spinner"/></div>
      ) : (
        <div className="panel">
          <h2 style={{marginBottom:'1.25rem'}}>Staff Members</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {staff.map(s=>(
                  <tr key={s.id}>
                    <td style={{fontWeight:600}}>{s.name}</td>
                    <td>{s.email}</td>
                    <td><span className={`pill pill-${s.is_active?'available':'closed'}`}>{s.is_active?'active':'revoked'}</span></td>
                    <td>
                      {s.is_active && <button className="btn btn-sm btn-danger" onClick={()=>revoke(s.id)}>Revoke</button>}
                      {!s.is_active && <button className="btn btn-sm btn-primary" onClick={()=>restore(s.id)}>Restore</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {staff.length===0 && <div className="empty-state">No staff members yet.</div>}
          </div>
        </div>
      )}

      {tempCred && <TempPasswordModal email={tempCred.email} tempPassword={tempCred.tempPassword} onClose={()=>setTempCred(null)} />}
    </>
  );
}

// Small read-only stat card for the activity dashboard header. Pure
// presentation, no data fetching of its own — parent passes the number in.
function StatCard({ label, value, accent }) {
  return (
    <div className="panel" style={{flex:'1 1 160px', padding:'1rem 1.25rem', textAlign:'center'}}>
      <div style={{fontSize:'1.6rem', fontWeight:700, color: accent || '#1e293b'}}>{value}</div>
      <div style={{fontSize:'.78rem', color:'#64748b', marginTop:'.25rem'}}>{label}</div>
    </div>
  );
}

// Shows what staff (and the lead) have actually been working on — was
// staff active today, what did they touch. Read-only, org-scoped server-
// side (GET /staff/activity), newest first, capped at the last 200 rows.
//
// Dashboard summary cards above the table are computed entirely from the
// same `activity` data already fetched below — no extra API calls, so
// this is purely additive and can't affect the existing table or the
// backend in any way.
function ActivityLogPanel() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getStaffActivity();
      setActivity(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isToday = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  };

  const stats = useMemo(() => {
    if (activity.length === 0) return null;

    const todayCount = activity.filter(a => isToday(a.created_at)).length;

    const byStaff = {};
    const byAction = { create: 0, edit: 0, claim: 0, delete: 0 };
    for (const a of activity) {
      byStaff[a.staff_name] = (byStaff[a.staff_name] || 0) + 1;
      if (byAction[a.action] !== undefined) byAction[a.action]++;
    }
    const mostActive = Object.entries(byStaff).sort((a, b) => b[1] - a[1])[0];

    return {
      total: activity.length,
      today: todayCount,
      mostActiveName: mostActive?.[0] || '—',
      mostActiveCount: mostActive?.[1] || 0,
      byAction,
    };
  }, [activity]);

  return (
    <div>
      {stats && (
        <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', marginBottom:'1.25rem'}}>
          <StatCard label="Total Actions Logged" value={stats.total} />
          <StatCard label="Actions Today" value={stats.today} accent="#059669" />
          <StatCard label="Most Active Staff" value={stats.mostActiveName} />
          <StatCard label="Created / Edited / Deleted" value={`${stats.byAction.create} / ${stats.byAction.edit} / ${stats.byAction.delete}`} />
        </div>
      )}

      <div className="panel">
        <h2 style={{marginBottom:'1.25rem'}}>Staff Activity Log</h2>
        {error && <div className="auth-error">{error}</div>}

        {loading ? (
          <div className="spinner-wrap"><div className="spinner"/></div>
        ) : activity.length === 0 ? (
          <div className="empty-state">No activity recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Staff Member</th><th>Action</th><th>Entity</th><th>When</th></tr></thead>
              <tbody>
                {activity.map(a => (
                  <tr key={a.id}>
                    <td style={{fontWeight:600}}>{a.staff_name}</td>
                    <td>{ACTION_LABELS[a.action] || a.action}</td>
                    <td>
                      {ENTITY_LABELS[a.entity_type] || a.entity_type}
                      {a.entity_label && <div style={{fontSize:'.78rem', color:'#64748b'}}>{a.entity_label}</div>}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {isToday(a.created_at)
                        ? <span className="pill pill-available">Today, {new Date(a.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                        : new Date(a.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Read-only report visibility for Org Lead — view reports in the org's
// jurisdiction, same data Org Staff sees on /reports/manage, but this
// panel has no status dropdown and calls a separate read-only backend
// route (GET /reports/lead-view) rather than the staff endpoint, so
// there is no code path here that can change a report's status.
function ReportsViewPanel() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [statusSort, setStatusSort] = useState(null); // null | 'asc' | 'desc'
  const [severitySort, setSeveritySort] = useState(null); // null | 'asc' | 'desc'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getOrgLeadReports();
      setReports(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Fixed pipeline order (not alphabetical) so sorting reads as
  // "earliest in the review pipeline first" / "latest first", not A-Z.
  const STATUS_ORDER = { pending: 0, reviewed: 1, resolved: 2 };
  const SEVERITY_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

  const filtered = useMemo(() => {
    let result = reports.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.district || ''} ${r.category || ''} ${r.problem_type || ''} ${r.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (statusSort) {
      result = [...result].sort((a, b) => {
        const diff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        return statusSort === 'asc' ? diff : -diff;
      });
    } else if (severitySort) {
      result = [...result].sort((a, b) => {
        const diff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
        return severitySort === 'asc' ? diff : -diff;
      });
    }

    return result;
  }, [reports, search, statusFilter, statusSort, severitySort]);

  // Only one column sorts at a time — clicking one clears the other, so
  // the table's order is never ambiguous between two active sort keys.
  const toggleStatusSort = () => {
    setSeveritySort(null);
    setStatusSort(prev => prev === null ? 'asc' : prev === 'asc' ? 'desc' : null);
  };

  const toggleSeveritySort = () => {
    setStatusSort(null);
    setSeveritySort(prev => prev === null ? 'asc' : prev === 'asc' ? 'desc' : null);
  };

  const counts = useMemo(() => {
    const c = { all: reports.length, pending: 0, reviewed: 0, resolved: 0 };
    for (const r of reports) { if (c[r.status] !== undefined) c[r.status]++; }
    return c;
  }, [reports]);

  return (
    <div className="panel">
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'.4rem', flexWrap:'wrap', gap:'.5rem'}}>
        <h2>Reports in Your Jurisdiction</h2>
        <span style={{fontSize:'.78rem', color:'#64748b'}}>View only — status changes are handled by your Org Staff</span>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div style={{display:'flex', gap:'.5rem', flexWrap:'wrap', margin:'1rem 0'}}>
        {['all', 'pending', 'reviewed', 'resolved'].map(s => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)} ({counts[s] ?? 0})
          </button>
        ))}
        <input
          placeholder="Search by district, category, or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{flex:'1 1 240px', padding:'.4rem .6rem', border:'1px solid #cbd5e1', borderRadius:'6px'}}
        />
      </div>

      {loading ? (
        <div className="spinner-wrap"><div className="spinner"/></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No reports match this view.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>District</th><th>Category</th><th>Type</th>
                <th
                  onClick={toggleSeveritySort}
                  style={{cursor:'pointer', userSelect:'none'}}
                  title="Click to sort by severity"
                >
                  Severity {severitySort === 'asc' ? '▲' : severitySort === 'desc' ? '▼' : '⇅'}
                </th>
                <th
                  onClick={toggleStatusSort}
                  style={{cursor:'pointer', userSelect:'none'}}
                  title="Click to sort by status"
                >
                  Status {statusSort === 'asc' ? '▲' : statusSort === 'desc' ? '▼' : '⇅'}
                </th>
                <th>Confirmations</th><th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{fontWeight:600}}>{r.district || '—'}</td>
                  <td>{r.category}</td>
                  <td>{r.problem_type || '—'}</td>
                  <td><span className={`pill ${SEVERITY_PILL[r.severity] || ''}`}>{r.severity || '—'}</span></td>
                  <td><span className={`pill ${STATUS_PILL[r.status] || ''}`}>{r.status}</span></td>
                  <td>{r.confirmation_count ?? 0}</td>
                  <td style={{whiteSpace:'nowrap'}}>{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TABS = ['staff', 'reports', 'activity'];
const TAB_LABELS = { staff: 'Staff Management', reports: 'Reports', activity: 'Activity Log' };

export default function StaffManagement() {
  const [tab, setTab] = useState('staff');

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h3>Organization</h3>
        {TABS.map(t => (
          <button key={t}
            className={`sidebar-link ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </aside>

      <div className="admin-content">
        {tab === 'staff' && <StaffMembersPanel/>}
        {tab === 'reports' && <ReportsViewPanel/>}
        {tab === 'activity' && <ActivityLogPanel/>}
      </div>
    </div>
  );
}