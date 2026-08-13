import React, { useState, useEffect } from 'react';
import { getRoutes, getReports } from '../services/api';
import ConfirmButton from '../components/ConfirmButton';
import NearMeButton from '../components/NearMeButton';
import { useNearMe, areaMatches, nearestItems } from '../hooks/useNearMe';

export default function Transportation() {
  const [routes,  setRoutes]  = useState([]);
  const [issues,  setIssues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const nearMe = useNearMe();

  useEffect(() => {
    Promise.all([getRoutes(), getReports({ category: 'transportation' })])
      .then(([r, i]) => { setRoutes(r.data); setIssues(i.data.filter(x => x.status !== 'resolved')); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Transport routes have no single 'area' field — matches if EITHER the
  // origin or destination fuzzy-matches the citizen's detected district,
  // since a route touching their area at all is relevant to them.
  const nearMeRouteFilter = (r) =>
    !nearMe.myDistrict || areaMatches(r.origin, nearMe.myDistrict) || areaMatches(r.destination, nearMe.myDistrict);
  // Routes have no lat/lng at all (only text origin/destination), so a
  // distance-based fallback isn't possible there — only the reported
  // issues (which do have coordinates) get the nearest-results fallback.
  const areaMatchedIssues = issues.filter(i => !nearMe.myDistrict || areaMatches(i.district, nearMe.myDistrict));
  const usingIssuesFallback = nearMe.myDistrict && areaMatchedIssues.length === 0 && nearMe.myCoords;
  const visibleIssues = usingIssuesFallback ? nearestItems(issues, nearMe.myCoords) : areaMatchedIssues;

  const hasIssues   = visibleIssues.length > 0;
  const filtered    = (filter === 'all' ? routes : routes.filter(r => r.status === filter)).filter(nearMeRouteFilter);

  return (
    <main>
      {/* Live ticker */}
      <div style={{
        background: hasIssues ? '#dc2626' : '#059669',
        color:'#fff', padding:'.5rem 0', overflow:'hidden',
        fontSize:'.82rem', fontWeight:600,
      }}>
        <marquee behavior="scroll" direction="left" scrollamount="7">
          {hasIssues
            ? '🚨 LIVE TRANSIT NOTICES:  ' + visibleIssues.map(i=>`[${i.problem_type}] at ${i.location_name} — "${i.description}"`).join('     •     ')
            : '🟢  All regional transit lines, public fleets, and commuter routes are currently tracking on normal operational schedules.  🟢'}
        </marquee>
      </div>

      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">🚌</div>
            <div><h1>Transportation</h1><p>Regional bus routes, intercity travel, schedules, and live disruption reports.</p></div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section style={{background:'var(--navy-800)',padding:'1.25rem 0'}}>
        <div className="container">
          <div style={{display:'flex',gap:'2rem',flexWrap:'wrap'}}>
            {[
              ['Total Routes',   routes.length,                       '#fff'],
              ['Normal',         routes.filter(r=>r.status==='normal').length,   '#10b981'],
              ['Delayed',        routes.filter(r=>r.status==='delayed').length,  '#f59e0b'],
              ['Suspended',      routes.filter(r=>r.status==='suspended').length,'#ef4444'],
              ['Active Reports', issues.length,                       '#3b82f6'],
            ].map(([label,val,color])=>(
              <div key={label}>
                <div style={{fontSize:'1.6rem',fontWeight:700,color,fontFamily:'var(--font-mono)'}}>{val}</div>
                <div style={{fontSize:'.78rem',color:'var(--gray-400)'}}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <NearMeButton myDistrict={nearMe.myDistrict} detecting={nearMe.detecting} error={nearMe.error}
            onRequest={nearMe.requestLocation} onClear={nearMe.clear} />

          <div style={{display:'flex',gap:'.5rem',marginBottom:'1.25rem',flexWrap:'wrap'}}>
            {[['all','All routes'],['normal','Normal'],['delayed','Delayed'],['suspended','Suspended']].map(([k,l])=>(
              <button key={k}
                onClick={()=>setFilter(k)}
                className={`btn btn-sm ${filter===k?'btn-primary':'btn-secondary'}`}>{l}</button>
            ))}
          </div>
          {loading ? <div className="spinner-wrap"><div className="spinner"/></div> : (
            filtered.length === 0 ? (
              <div className="empty-state">No routes match this filter.</div>
            ) : (
            <div className="card-grid">
              {filtered.map(r=>(
                <div key={r.id} className="card">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'.65rem'}}>
                    <span style={{background:'var(--navy-800)',color:'var(--white)',padding:'.2rem .6rem',borderRadius:'var(--radius-sm)',fontWeight:700,fontFamily:'var(--font-mono)'}}>{r.route_number}</span>
                    <span className={`pill pill-${r.status}`}>{r.status}</span>
                  </div>
                  <h3 style={{marginBottom:'.35rem'}}>{r.origin} → {r.destination}</h3>
                  <p style={{fontSize:'.85rem',color:'var(--navy-500)'}}>Stops: {r.stops} · Duration: {r.duration}</p>
                  <p style={{fontSize:'.85rem',color:'var(--navy-500)',marginTop:'.35rem'}}>Frequency: {r.frequency} · Price: {r.price_range}</p>
                </div>
              ))}
            </div>
            )
          )}
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>Active Transit Disruption Logs</h2>
            <p style={{color:'var(--navy-500)',margin:'.5rem 0 1.25rem',fontSize:'.875rem'}}>Submitted by commuters experiencing service gaps or terminal issues in real time.</p>
            {usingIssuesFallback && (
              <div style={{ background: '#eff6ff', color: '#1e40af', padding: '.7rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '.85rem', marginBottom: '1rem' }}>
                No disruptions found in "{nearMe.myDistrict}" specifically — showing the nearest ones by distance instead.
              </div>
            )}
            {hasIssues ? (
              <div className="card-grid">
                {visibleIssues.map(i=>(
                  <div key={i.id} className="card">
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                      <span className="pill pill-high">⚠️ {i.problem_type}</span>
                      <small style={{color:'var(--gray-400)',fontSize:'.72rem',fontFamily:'var(--font-mono)'}}>LIVE</small>
                    </div>
                    <h3>📍 {i.location_name}{usingIssuesFallback && ` · ${i._distanceKm < 1 ? `${Math.round(i._distanceKm*1000)}m` : `${i._distanceKm.toFixed(1)}km`} away`}</h3>
                    <p style={{marginTop:'.35rem',fontSize:'.875rem'}}>"{i.description}"</p>
                    <small style={{color:'var(--gray-400)',display:'block',marginTop:'.65rem'}}>Reported by: <strong>{i.name||'Anonymous'}</strong></small>
                    <ConfirmButton report={i} />
                  </div>
                ))}
              </div>
            ) : nearMe.myDistrict ? (
              <div className="empty-state">🟢 No transit disruptions near {nearMe.myDistrict}.</div>
            ) : <div className="empty-state">🟢 No transit delays or terminal closures reported by users.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}