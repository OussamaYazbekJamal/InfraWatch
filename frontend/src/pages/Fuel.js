import React, { useState, useEffect } from 'react';
import { getFuelStations, getReports, getFuelBrands } from '../services/api';
import ConfirmButton from '../components/ConfirmButton';
import NearMeButton from '../components/NearMeButton';
import { useNearMe, areaMatches, nearestItems } from '../hooks/useNearMe';

export default function Fuel() {
  const [stations, setStations] = useState([]);
  const [issues,   setIssues]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('all');
  const [brands,      setBrands]      = useState([]);
  const [brandFilter, setBrandFilter] = useState('all');
  const nearMe = useNearMe();

  useEffect(() => {
    Promise.all([getFuelStations(), getReports({ category:'fuel' }), getFuelBrands()])
      .then(([s,r,b]) => { setStations(s.data); setIssues(r.data.filter(i => i.status !== 'resolved')); setBrands(b.data); })
      .catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  const areaMatched = stations
    .filter(s => filter==='all' || s.status===filter)
    .filter(s => brandFilter==='all' || s.brand===brandFilter)
    .filter(s => !nearMe.myDistrict || areaMatches(s.area, nearMe.myDistrict));

  // If "near me" is active but no station's area name matched (most real
  // locations won't, given only 3 seeded demo regions exist so far), fall
  // back to the nearest stations by real distance instead of a blank list.
  const usingNearestFallback = nearMe.myDistrict && areaMatched.length === 0 && nearMe.myCoords;
  const filtered = usingNearestFallback
    ? nearestItems(stations.filter(s => (filter==='all'||s.status===filter) && (brandFilter==='all'||s.brand===brandFilter)), nearMe.myCoords)
    : areaMatched;

  const visibleIssues = issues.filter(i => !nearMe.myDistrict || areaMatches(i.district, nearMe.myDistrict));

  const statusColor = { available:'#10b981', limited:'#f59e0b', closed:'#ef4444' };

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">⛽</div>
            <div><h1>Fuel</h1><p>Station availability, live prices, and crowdsourced shortage alerts.</p></div>
          </div>
        </div>
      </section>

      <section style={{background:'var(--navy-800)',padding:'1.25rem 0'}}>
        <div className="container">
          <div style={{display:'flex',gap:'2rem',flexWrap:'wrap'}}>
            {[
              ['Total Stations', stations.length, '#fff'],
              ['Available',  stations.filter(s=>s.status==='available').length, '#10b981'],
              ['Limited',    stations.filter(s=>s.status==='limited').length,   '#f59e0b'],
              ['Closed',     stations.filter(s=>s.status==='closed').length,    '#ef4444'],
              ['Shortage Reports', issues.length, '#3b82f6'],
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

          <div style={{display:'flex',gap:'.5rem',marginBottom:'1.25rem',flexWrap:'wrap'}}>
            {[['all','All'],['available','Available'],['limited','Limited'],['closed','Closed']].map(([k,l])=>(
              <button key={k} onClick={()=>setFilter(k)}
                className={`btn btn-sm ${filter===k?'btn-primary':'btn-secondary'}`}>{l}</button>
            ))}
          </div>

          {brands.length > 0 && (
            <div style={{display:'flex',gap:'.5rem',marginBottom:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:'.8rem',color:'var(--navy-500)',fontWeight:600}}>Brand:</span>
              <button onClick={()=>setBrandFilter('all')}
                className={`btn btn-sm ${brandFilter==='all'?'btn-primary':'btn-secondary'}`}>All</button>
              {brands.map(b=>(
                <button key={b} onClick={()=>setBrandFilter(b)}
                  className={`btn btn-sm ${brandFilter===b?'btn-primary':'btn-secondary'}`}>{b}</button>
              ))}
            </div>
          )}

          {usingNearestFallback && (
            <div style={{ background: '#eff6ff', color: '#1e40af', padding: '.7rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '.85rem', marginBottom: '1rem' }}>
              No stations found in "{nearMe.myDistrict}" specifically — showing the nearest stations by distance instead.
            </div>
          )}

          {loading ? <div className="spinner-wrap"><div className="spinner"/></div> : (
            <div className="card-grid">
              {filtered.map(s=>(
                <div key={s.id} className="card">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'.75rem'}}>
                    <h3 style={{margin:0}}>{s.name}</h3>
                    <span className={`pill pill-${s.status}`}>{s.status}</span>
                  </div>
                  <p style={{color:'var(--navy-500)',fontSize:'.85rem',marginBottom:'.35rem'}}>
                    📍 {s.area}{s.brand ? ` · ${s.brand}` : ''}
                    {usingNearestFallback && ` · ${s._distanceKm < 1 ? `${Math.round(s._distanceKm*1000)}m` : `${s._distanceKm.toFixed(1)}km`} away`}
                  </p>
                  {s.landmark_note && (
                    <p style={{color:'var(--gray-400)',fontSize:'.78rem',marginBottom:'.5rem',fontStyle:'italic'}}>
                      {s.landmark_note}
                    </p>
                  )}
                  <div style={{display:'flex',flexDirection:'column',gap:'.3rem',fontSize:'.875rem'}}>
                    <span>⛽ Diesel: <strong style={{color:'var(--navy-800)'}}>${s.diesel_price}/L</strong></span>
                    <span>🚗 Gasoline: <strong style={{color:'var(--navy-800)'}}>${s.gasoline_price}/L</strong></span>
                  </div>
                  <div style={{marginTop:'.75rem',paddingTop:'.75rem',borderTop:'1px solid var(--gray-100)',fontSize:'.75rem',color:'var(--gray-400)'}}>
                    Updated: {new Date(s.updated_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
              {filtered.length===0 && <div className="empty-state" style={{gridColumn:'1/-1'}}>No stations match this filter.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>6-Month Price Trends</h2>
            <p style={{color:'var(--navy-500)',fontSize:'.875rem',marginBottom:'1.25rem'}}>National average reference prices — admin updated.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Month</th><th>Diesel</th><th>Gasoline</th><th>Trend</th></tr></thead>
                <tbody>
                  {[['Jan','$1.75','$1.82','— Baseline'],['Feb','$1.78','$1.85','↑ Up slightly'],
                    ['Mar','$1.82','$1.89','↑ Rising'],  ['Apr','$1.85','$1.92','↑ Peak'],
                    ['May','$1.83','$1.90','↓ Correction'],['Jun','$1.84','$1.91','→ Stable']].map(([m,...r])=>(
                    <tr key={m}><td><strong>{m}</strong></td>{r.map((v,i)=><td key={i}>{v}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>📢 Real-Time Citizen Shortage Reports</h2>
            <p style={{color:'var(--navy-500)',margin:'.5rem 0 1.25rem',fontSize:'.875rem'}}>Crowdsourced reports flagging pump dry-outs, congestion, or closures.</p>
            {visibleIssues.length > 0 ? (
              <div className="card-grid">
                {visibleIssues.map(i=>(
                  <div key={i.id} className="card">
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                      <span className={`pill pill-${i.severity}`}>{i.problem_type}</span>
                      <small style={{color:'var(--gray-400)',fontFamily:'var(--font-mono)',fontSize:'.7rem'}}>LIVE</small>
                    </div>
                    <h3>📍 {i.fuel_station_name ? `${i.fuel_station_name} (${i.fuel_station_brand})` : i.location_name}</h3>
                    <p style={{marginTop:'.35rem',fontSize:'.875rem'}}>"{i.description}"</p>
                    <small style={{color:'var(--gray-400)',display:'block',marginTop:'.65rem'}}>By: <strong>{i.name||'Anonymous'}</strong></small>
                    <ConfirmButton report={i} />
                  </div>
                ))}
              </div>
            ) : nearMe.myDistrict ? (
              <div className="empty-state">🟢 No fuel shortages reported near {nearMe.myDistrict}.</div>
            ) : <div className="empty-state">🟢 No fuel shortages or long lines reported at this time.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}