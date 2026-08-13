import React, { useState, useEffect } from 'react';
import { getReports, getFloodRisk } from '../services/api';
import SeverityPill, { StatusPill } from '../components/SeverityPill';
import ConfirmButton from '../components/ConfirmButton';
import NearMeButton from '../components/NearMeButton';
import { useNearMe, areaMatches, nearestItems } from '../hooks/useNearMe';

// Small component so each flooding report can independently fetch and
// show its own rainfall corroboration, without blocking the rest of the
// page while weather lookups are in flight. Computed live via the
// /weather/flood-risk endpoint - no database changes needed, since this
// is corroborating evidence, not stored data.
function FloodRiskBadge({ lat, lng }) {
  const [risk, setRisk] = useState(null);

  useEffect(() => {
    if (!lat || !lng) return;
    getFloodRisk(lat, lng).then(r => setRisk(r.data)).catch(() => {});
  }, [lat, lng]);

  if (!risk) return null;

  const colors = {
    high: '#dc2626', moderate: '#f59e0b', low: '#3b82f6', none: '#94a3b8',
  };

  // Actionable, not just informational: a flood report with NO
  // corroborating rain is worth flagging for admin attention - it likely
  // means something other than weather (burst pipe, sewage backup,
  // drainage failure) rather than being less credible. A flood report
  // WITH heavy rain gets a simple confirmation instead.
  const isUnexplained = risk.risk_level === 'none';

  return (
    <div style={{
      marginTop: '.5rem', padding: '.5rem .75rem', borderRadius: 'var(--radius-md)',
      background: isUnexplained ? '#fef3c7' : '#f8fafc',
      border: `1px solid ${colors[risk.risk_level]}`, fontSize: '.8rem',
    }}>
      {isUnexplained ? (
        <>
          ⚠️ <strong style={{ color: '#92400e' }}>No recent rain recorded</strong> —
          {' '}possibly a non-weather cause (burst pipe, drainage failure). Recommend priority review.
        </>
      ) : (
        <>
          🌧️ <strong style={{ color: colors[risk.risk_level] }}>
            {risk.risk_level.charAt(0).toUpperCase() + risk.risk_level.slice(1)} flood risk
          </strong> — consistent with {risk.rainfall_mm_48h}mm rainfall in the last 48h
        </>
      )}
    </div>
  );
}

export default function Roads() {
  const [issues,  setIssues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const nearMe = useNearMe();

  useEffect(() => {
    getReports({ category:'roads' }).then(r=>setIssues(r.data.filter(i => i.status !== 'resolved'))).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  const areaMatched = (filter==='all' ? issues : issues.filter(i=>i.severity===filter))
    .filter(i => !nearMe.myDistrict || areaMatches(i.district, nearMe.myDistrict));
  const usingNearestFallback = nearMe.myDistrict && areaMatched.length === 0 && nearMe.myCoords;
  const filtered = usingNearestFallback
    ? nearestItems(filter==='all' ? issues : issues.filter(i=>i.severity===filter), nearMe.myCoords)
    : areaMatched;

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">🚧</div>
            <div><h1>Roads</h1><p>Road damage reports, hazard categories, severity ratings, and photos from citizens.</p></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <NearMeButton myDistrict={nearMe.myDistrict} detecting={nearMe.detecting} error={nearMe.error}
            onRequest={nearMe.requestLocation} onClear={nearMe.clear} />

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'1rem',marginBottom:'1.25rem'}}>
            <div className="section-header" style={{margin:0}}>
              <h2>{filtered.length} Active Road Reports</h2>
            </div>
            <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
              {[['all','All'],['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].map(([k,l])=>(
                <button key={k} onClick={()=>setFilter(k)}
                  className={`btn btn-sm ${filter===k?'btn-primary':'btn-secondary'}`}>{l}</button>
              ))}
            </div>
          </div>

          {usingNearestFallback && (
            <div style={{ background: '#eff6ff', color: '#1e40af', padding: '.7rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '.85rem', marginBottom: '1rem' }}>
              No road reports found in "{nearMe.myDistrict}" specifically — showing the nearest ones by distance instead.
            </div>
          )}

          {loading ? <div className="spinner-wrap"><div className="spinner"/></div> :
           filtered.length > 0 ? (
            <div className="card-grid">
              {filtered.map(i=>(
                <div key={i.id} className="card">
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                    <SeverityPill value={i.severity}/>
                    <StatusPill value={i.status}/>
                  </div>
                  <h3>📍 {i.location_name}{usingNearestFallback && ` · ${i._distanceKm < 1 ? `${Math.round(i._distanceKm*1000)}m` : `${i._distanceKm.toFixed(1)}km`} away`}</h3>
                  <p style={{color:'var(--green-500)',fontWeight:600,fontSize:'.85rem',margin:'.35rem 0'}}>{i.problem_type}</p>
                  <p style={{fontSize:'.85rem',color:'var(--navy-500)'}}>{i.description}</p>
                  {i.image_url && (
                    <img src={i.image_url} alt={i.problem_type}
                      style={{marginTop:'.75rem',borderRadius:'var(--radius-md)',width:'100%',height:160,objectFit:'cover'}}/>
                  )}
                  {i.problem_type === 'Flooding' && (
                    <FloodRiskBadge lat={i.latitude} lng={i.longitude} />
                  )}
                  <small style={{color:'var(--gray-400)',display:'block',marginTop:'.65rem'}}>
                    Reported by: <strong>{i.name||'Anonymous'}</strong> · {new Date(i.created_at).toLocaleDateString()}
                  </small>
                  <ConfirmButton report={i} />
                </div>
              ))}
            </div>
          ) : nearMe.myDistrict ? (
            <div className="empty-state">🚧 No road reports near {nearMe.myDistrict}.</div>
          ) : <div className="empty-state">🚧 No road reports match this filter.</div>}
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-header center"><h2>Common Issue Categories</h2></div>
          <div className="grid-2">
            {[
              ['Potholes & Surface Damage','high','Deep holes and uneven surfaces posing risks to vehicles and pedestrians.'],
              ['Flooding & Drainage','medium','Poor drainage causing water accumulation and road blockage during rain.'],
              ['Missing Signage','medium','Missing or damaged signs and road markings that reduce safety.'],
              ['Structural Collapse','critical','Sections that have partially or fully collapsed — immediate intervention needed.'],
              ['Cracks','medium','Surface cracks that may indicate deeper structural deterioration.'],
              ['Flooding','high','Road sections impassable due to accumulated water.'],
            ].map(([title,sev,desc])=>(
              <div key={title} className="panel">
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem',alignItems:'center'}}>
                  <h3 style={{margin:0}}>{title}</h3>
                  <SeverityPill value={sev}/>
                </div>
                <p style={{color:'var(--navy-500)',fontSize:'.9rem'}}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}