import React, { useState, useEffect, useCallback } from 'react';
import { getReports, updateStatus, getOrganizations, approveOrganization, revokeOrganization, restoreOrganization } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import SeverityPill, { StatusPill } from '../components/SeverityPill';
import TempPasswordModal from '../components/TempPasswordModal';
import '../styles/admin.css';

// Post-pivot: Admin no longer manages fuel/offices/transport/health/outage
// data directly — that responsibility moved entirely to Org Staff/Lead.
// Admin only handles platform-level anomaly resolution (Reports) and org
// approval/revocation (Organizations). Reports here also has no delete —
// only status changes — same reasoning as Org Staff/Lead: citizen-submitted
// data shouldn't disappear silently, only ever change status.
const TABS = ['Reports','Organizations'];

// Severity order used for sorting — not alphabetical, since "critical"
// should sort as more severe than "low" regardless of letter order.
const SEVERITY_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
const STATUS_ORDER = { pending: 0, reviewed: 1, resolved: 2 };

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab,      setTab]      = useState('Reports');
  const [reports,  setReports]  = useState([]);
  const [orgs,     setOrgs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tempCred, setTempCred] = useState(null);
  // Click-to-sort state for the Reports table — sortKey is null until a
  // header is clicked; clicking the same header again flips direction.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => { if (!user||user.role!=='admin') navigate('/'); }, [user, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r,o] = await Promise.all([getReports(),getOrganizations()]);
      setReports(r.data); setOrgs(o.data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (id,status) => { await updateStatus(id,status); setReports(p=>p.map(r=>r.id===id?{...r,status}:r)); };

  const [orgError, setOrgError] = useState('');

  const approveOrg = async (id) => {
    setOrgError('');
    try {
      const { data } = await approveOrganization(id);
      setOrgs(p => p.map(o => o.id===id ? { ...o, status: 'approved' } : o));
      setTempCred({ email: data.org_lead.email, tempPassword: data.temp_password });
    } catch (err) {
      setOrgError(err.response?.data?.error || 'Failed to approve organization');
    }
  };
  const revokeOrg = async (id) => {
    if (!window.confirm('Revoke this organization? Its members will lose access.')) return;
    setOrgError('');
    try {
      await revokeOrganization(id);
      setOrgs(p => p.map(o => o.id===id ? { ...o, status: 'revoked' } : o));
    } catch (err) {
      setOrgError(err.response?.data?.error || 'Failed to revoke organization');
    }
  };
  const restoreOrg = async (id) => {
    setOrgError('');
    try {
      await restoreOrganization(id);
      setOrgs(p => p.map(o => o.id===id ? { ...o, status: 'approved' } : o));
    } catch (err) {
      setOrgError(err.response?.data?.error || 'Failed to restore organization');
    }
  };

  const counts = { pending:reports.filter(r=>r.status==='pending').length, reviewed:reports.filter(r=>r.status==='reviewed').length, resolved:reports.filter(r=>r.status==='resolved').length, critical:reports.filter(r=>r.severity==='critical').length };

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const [reportSearch, setReportSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  const sortedReports = [...reports];
  if (sortKey) {
    sortedReports.sort((a, b) => {
      let av, bv;
      if (sortKey === 'location') {
        av = (a.fuel_station_name ? `${a.fuel_station_name} (${a.fuel_station_brand})` : a.location_name) || '';
        bv = (b.fuel_station_name ? `${b.fuel_station_name} (${b.fuel_station_brand})` : b.location_name) || '';
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === 'severity') {
        av = SEVERITY_ORDER[a.severity] ?? -1;
        bv = SEVERITY_ORDER[b.severity] ?? -1;
      } else if (sortKey === 'status') {
        av = STATUS_ORDER[a.status] ?? -1;
        bv = STATUS_ORDER[b.status] ?? -1;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  const searchedReports = reportSearch.trim()
    ? sortedReports.filter(r => {
        const q = reportSearch.trim().toLowerCase();
        const loc = (r.fuel_station_name ? `${r.fuel_station_name} (${r.fuel_station_brand})` : r.location_name) || '';
        return loc.toLowerCase().includes(q)
          || (r.category || '').toLowerCase().includes(q)
          || (r.problem_type || '').toLowerCase().includes(q)
          || (r.name || '').toLowerCase().includes(q);
      })
    : sortedReports;

  const searchedOrgs = orgSearch.trim()
    ? orgs.filter(o => {
        const q = orgSearch.trim().toLowerCase();
        return (o.name || '').toLowerCase().includes(q)
          || (o.jurisdiction || '').toLowerCase().includes(q)
          || (o.contact_name || '').toLowerCase().includes(q)
          || (o.contact_email || '').toLowerCase().includes(q);
      })
    : orgs;

  const SortableHeader = ({ label, sortKeyName }) => (
    <th onClick={() => toggleSort(sortKeyName)} style={{ cursor: 'pointer', userSelect: 'none' }}>
      {label} {sortKey === sortKeyName ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h3>Admin Panel</h3>
        {TABS.map(t=>(
          <button key={t} className={`sidebar-link ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t}</button>
        ))}
      </aside>

      <div className="admin-content">
        <div className="stat-grid">
          {[['Total',reports.length,'#0f172a'],['Pending',counts.pending,'#f59e0b'],['Resolved',counts.resolved,'#10b981'],['Critical',counts.critical,'#ef4444']].map(([l,v,c])=>(
            <div key={l} className="stat-card">
              <div className="stat-label">{l}</div>
              <div className="stat-value" style={{color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {loading && <div className="spinner-wrap"><div className="spinner"/></div>}

        {!loading && tab==='Reports' && (
          <div className="panel">
            <h2 style={{marginBottom:'1.25rem'}}>All Reports</h2>
            <p style={{fontSize:'.8rem',color:'#64748b',marginBottom:'.75rem'}}>Click a column header to sort.</p>
            <input type="text" value={reportSearch} onChange={e=>setReportSearch(e.target.value)}
              placeholder="🔍 Search by location, category, type, or reporter…"
              style={{maxWidth:'400px', width:'100%', padding:'.6rem .85rem', borderRadius:'var(--radius-md)', border:'1.5px solid var(--gray-300)', fontSize:'.85rem', marginBottom:'1rem'}}/>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableHeader label="Location" sortKeyName="location" />
                    <th>Category</th>
                    <th>Type</th>
                    <SortableHeader label="Severity" sortKeyName="severity" />
                    <SortableHeader label="Status" sortKeyName="status" />
                    <th>Reporter</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {searchedReports.map(r=>(
                    <tr key={r.id}>
                      <td style={{fontWeight:600}}>{r.fuel_station_name ? `${r.fuel_station_name} (${r.fuel_station_brand})` : r.location_name}</td>
                      <td style={{textTransform:'capitalize'}}>{r.category}</td>
                      <td>{r.problem_type}</td>
                      <td><SeverityPill value={r.severity}/></td>
                      <td><StatusPill value={r.status}/></td>
                      <td style={{fontSize:'.82rem'}}>{r.name||'—'}</td>
                      <td>
                        <div className="admin-actions">
                          <select className="btn btn-sm btn-secondary" value={r.status} onChange={e=>changeStatus(r.id,e.target.value)}>
                            <option value="pending">Pending</option>
                            <option value="reviewed">Reviewed</option>
                            <option value="resolved">Resolved</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reports.length===0 && <div className="empty-state">No reports yet.</div>}
              {reports.length>0 && searchedReports.length===0 && <div className="empty-state">No reports match "{reportSearch}".</div>}
            </div>
          </div>
        )}

        {!loading && tab==='Organizations' && (
          <div className="panel">
            <h2 style={{marginBottom:'1.25rem'}}>Organizations</h2>
            <input type="text" value={orgSearch} onChange={e=>setOrgSearch(e.target.value)}
              placeholder="🔍 Search by name, jurisdiction, or contact…"
              style={{maxWidth:'400px', width:'100%', padding:'.6rem .85rem', borderRadius:'var(--radius-md)', border:'1.5px solid var(--gray-300)', fontSize:'.85rem', marginBottom:'1rem'}}/>
            {orgError && <div className="feedback-err" style={{marginBottom:'1rem'}}>{orgError}</div>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Type</th><th>Jurisdiction</th><th>Contact</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {searchedOrgs.map(o=>(
                    <tr key={o.id}>
                      <td style={{fontWeight:600}}>{o.name}</td>
                      <td style={{textTransform:'capitalize'}}>{o.type}</td>
                      <td>
                        {o.jurisdiction}
                        {o.jurisdiction_detail && <div style={{fontSize:'.75rem',color:'#64748b'}}>{o.jurisdiction_detail}</div>}
                      </td>
                      <td style={{fontSize:'.82rem'}}>
                        {o.contact_name}<br/>
                        <span style={{color:'#64748b'}}>{o.contact_email}</span>
                      </td>
                      <td style={{fontSize:'.82rem'}}>{o.contact_phone || '—'}</td>
                      <td><span className={`pill pill-${o.status}`}>{o.status}</span></td>
                      <td>
                        <div className="admin-actions">
                          {o.status==='pending' && <button className="btn btn-sm btn-primary" onClick={()=>approveOrg(o.id)}>Approve</button>}
                          {o.status!=='revoked' && <button className="btn btn-sm btn-danger" onClick={()=>revokeOrg(o.id)}>Revoke</button>}
                          {o.status==='revoked' && <button className="btn btn-sm btn-primary" onClick={()=>restoreOrg(o.id)}>Restore</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orgs.length===0 && <div className="empty-state">No organizations yet.</div>}
              {orgs.length>0 && searchedOrgs.length===0 && <div className="empty-state">No organizations match "{orgSearch}".</div>}
            </div>
          </div>
        )}
      </div>

      {tempCred && <TempPasswordModal email={tempCred.email} tempPassword={tempCred.tempPassword} onClose={()=>setTempCred(null)} />}
    </div>
  );
}