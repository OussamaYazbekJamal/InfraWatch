import React, { useState, useEffect } from 'react';
import { getOffices, getReports, getOfficeTypes } from '../services/api';
import ConfirmButton from '../components/ConfirmButton';
import NearMeButton from '../components/NearMeButton';
import { useNearMe, areaMatches, nearestItems } from '../hooks/useNearMe';

export default function Offices() {
  const [offices,     setOffices]     = useState([]);
  const [issues,      setIssues]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [typeFilter,  setTypeFilter]  = useState('all');
  const [types,       setTypes]       = useState([]);
  const nearMe = useNearMe();

  useEffect(() => {
    // category value 'offices' matches what the Report form now saves
    // for the Government Offices category.
    Promise.all([getOffices(), getReports({ category: 'offices' }), getOfficeTypes()])
      .then(([o, r, t]) => { setOffices(o.data); setIssues(r.data.filter(i => i.status !== 'resolved')); setTypes(t.data); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const areaMatched = offices
    .filter(o => typeFilter === 'all' || o.office_type === typeFilter)
    .filter(o => !nearMe.myDistrict || areaMatches(o.area, nearMe.myDistrict));

  const usingNearestFallback = nearMe.myDistrict && areaMatched.length === 0 && nearMe.myCoords;
  const filtered = usingNearestFallback
    ? nearestItems(offices.filter(o => typeFilter === 'all' || o.office_type === typeFilter), nearMe.myCoords)
    : areaMatched;

  const visibleIssues = issues.filter(i => !nearMe.myDistrict || areaMatches(i.district, nearMe.myDistrict));

  const typeLabel = (t) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">🏛️</div>
            <div><h1>Government Offices</h1><p>Municipalities, police stations, courts, and ministry branches near you.</p></div>
          </div>
        </div>
      </section>

      <section style={{background:'var(--navy-800)',padding:'1.25rem 0'}}>
        <div className="container">
          <div style={{display:'flex',gap:'2rem',flexWrap:'wrap'}}>
            {[
              ['Total Offices', offices.length, '#fff'],
              ['Issue Reports', issues.length, '#3b82f6'],
            ].map(([l,v,c])=>(
              <div key={l}>
                <div style={{fontSize:'1.6rem',fontWeight:700,color:c,fontFamily:'var(--font-mono)'}}>{v}</div>
                <div style={{fontSize:'.78rem',color:'var(--gray-400)'}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <NearMeButton myDistrict={nearMe.myDistrict} detecting={nearMe.detecting} error={nearMe.error}
            onRequest={nearMe.requestLocation} onClear={nearMe.clear} />

          {types.length > 0 && (
            <div style={{display:'flex',gap:'.5rem',marginBottom:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:'.8rem',color:'var(--navy-500)',fontWeight:600}}>Type:</span>
              <button onClick={()=>setTypeFilter('all')}
                className={`btn btn-sm ${typeFilter==='all'?'btn-primary':'btn-secondary'}`}>All</button>
              {types.map(t=>(
                <button key={t} onClick={()=>setTypeFilter(t)}
                  className={`btn btn-sm ${typeFilter===t?'btn-primary':'btn-secondary'}`}>{typeLabel(t)}</button>
              ))}
            </div>
          )}

          {usingNearestFallback && (
            <div style={{ background: '#eff6ff', color: '#1e40af', padding: '.7rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '.85rem', marginBottom: '1rem' }}>
              No offices found in "{nearMe.myDistrict}" specifically — showing the nearest offices by distance instead.
            </div>
          )}

          {loading ? <div className="spinner-wrap"><div className="spinner"/></div> : (
            <div className="card-grid">
              {filtered.map(o=>(
                <div key={o.id} className="card">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'.75rem'}}>
                    <h3 style={{margin:0}}>{o.name}</h3>
                    {o.status && <span className={`pill pill-${o.status}`}>{o.status}</span>}
                  </div>
                  <p style={{color:'var(--navy-500)',fontSize:'.85rem',marginBottom:'.35rem'}}>
                    📍 {o.area}{o.office_type ? ` · ${typeLabel(o.office_type)}` : ''}
                    {usingNearestFallback && ` · ${o._distanceKm < 1 ? `${Math.round(o._distanceKm*1000)}m` : `${o._distanceKm.toFixed(1)}km`} away`}
                  </p>
                  {o.landmark_note && (
                    <p style={{color:'var(--gray-400)',fontSize:'.78rem',marginBottom:'.5rem',fontStyle:'italic'}}>
                      {o.landmark_note}
                    </p>
                  )}
                  <div style={{marginTop:'.75rem',paddingTop:'.75rem',borderTop:'1px solid var(--gray-100)',fontSize:'.75rem',color:'var(--gray-400)'}}>
                    Updated: {new Date(o.updated_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
              {filtered.length===0 && <div className="empty-state" style={{gridColumn:'1/-1'}}>No offices match this filter.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>📢 Real-Time Citizen Reports</h2>
            <p style={{color:'var(--navy-500)',margin:'.5rem 0 1.25rem',fontSize:'.875rem'}}>Crowdsourced reports about government office issues — closures, delays, access problems.</p>
            {visibleIssues.length > 0 ? (
              <div className="card-grid">
                {visibleIssues.map(i=>(
                  <div key={i.id} className="card">
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                      <span className={`pill pill-${i.severity}`}>{i.problem_type}</span>
                      <small style={{color:'var(--gray-400)',fontFamily:'var(--font-mono)',fontSize:'.7rem'}}>LIVE</small>
                    </div>
                    <h3>📍 {i.government_office_name || i.location_name}</h3>
                    <p style={{marginTop:'.35rem',fontSize:'.875rem'}}>"{i.description}"</p>
                    <small style={{color:'var(--gray-400)',display:'block',marginTop:'.65rem'}}>By: <strong>{i.name||'Anonymous'}</strong></small>
                    <ConfirmButton report={i} />
                  </div>
                ))}
              </div>
            ) : nearMe.myDistrict ? (
              <div className="empty-state">🟢 No office issues reported near {nearMe.myDistrict}.</div>
            ) : <div className="empty-state">🟢 No office issues reported at this time.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}