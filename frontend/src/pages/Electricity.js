import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getReports } from '../services/api';
import SeverityPill, { StatusPill } from '../components/SeverityPill';
import ConfirmButton from '../components/ConfirmButton';
import NearMeButton from '../components/NearMeButton';
import { useNearMe, areaMatches, nearestItems } from '../hooks/useNearMe';

const API = '/api';

export default function Electricity() {
  const [issues,    setIssues]    = useState([]);
  const nearMe = useNearMe();
  const [outage,    setOutage]    = useState([]);
  const [districts, setDistricts] = useState([]);
  const [district,  setDistrict]  = useState('Beirut');
  const [loading,   setLoading]   = useState(true);
  const [chartLoad, setChartLoad] = useState(false);

  useEffect(() => {
    Promise.all([
      getReports({ category: 'electricity' }),
      axios.get(`${API}/outage/districts`),
    ]).then(([r, d]) => {
      setIssues(r.data.filter(i => i.status !== 'resolved'));
      setDistricts(d.data);
    }).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  const loadChart = useCallback(async (d) => {
    setChartLoad(true);
    try {
      const r = await axios.get(`${API}/outage?district=${d}&year=2025`);
      setOutage(r.data);
    } catch {}
    finally { setChartLoad(false); }
  }, []);

  useEffect(() => { loadChart(district); }, [district, loadChart]);

  const maxH = Math.max(...outage.map(o => parseFloat(o.avg_hours)), 1);

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">⚡</div>
            <div><h1>Electricity</h1><p>Outage schedules, safety guidance, and live citizen reports by district.</p></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid-3">
            <div className="panel"><h3>Outage Tips</h3><p>Unplug sensitive electronics during cuts, keep flashlights nearby, and charge devices when power is available.</p></div>
            <div className="panel"><h3>Safety Guidelines</h3><p>Never touch downed lines. Report damaged infrastructure immediately and keep generators outdoors.</p></div>
            <div className="panel"><h3>Typical Schedule</h3><p>Rationing is generally 3 hours on / 3 hours off. Actual schedules vary by district and generator availability.</p></div>
          </div>
        </div>
      </section>

      {/* Live outage chart from DB */}
      <section className="section section-alt">
        <div className="container">
          <div className="panel">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'1rem',marginBottom:'1.5rem'}}>
              <div>
                <h2 style={{marginBottom:'.25rem'}}>Average Daily Outage Hours — 2025</h2>
                <p style={{color:'var(--navy-500)',fontSize:'.875rem'}}>Data per district, sourced from EDL regional reports and admin updates.</p>
              </div>
              <select
                value={district}
                onChange={e=>setDistrict(e.target.value)}
                style={{padding:'.5rem .9rem',borderRadius:'var(--radius-md)',border:'1.5px solid var(--gray-300)',fontFamily:'var(--font-sans)',fontSize:'.875rem',background:'var(--white)'}}>
                {districts.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {chartLoad ? <div className="spinner-wrap"><div className="spinner"/></div> : (
              <div style={{display:'flex',gap:'1rem',alignItems:'flex-end',height:'200px'}}>
                {outage.map(o=>(
                  <div key={o.month_name} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'.35rem',minWidth:0}}>
                    <span style={{fontSize:'.72rem',fontWeight:700,color:'var(--navy-500)',whiteSpace:'nowrap'}}>{o.avg_hours}h</span>
                    <div style={{
                      width:'100%',
                      background: parseFloat(o.avg_hours)>20 ? 'var(--red-500)' : parseFloat(o.avg_hours)>17 ? 'var(--amber-500)' : 'var(--green-500)',
                      borderRadius:'6px 6px 0 0',
                      height:`${(parseFloat(o.avg_hours)/maxH)*170}px`,
                      transition:'height .4s ease',
                    }}/>
                    <span style={{fontSize:'.72rem',fontWeight:600,color:'var(--navy-600)'}}>{o.month_name}</span>
                  </div>
                ))}
                {outage.length === 0 && <div className="empty-state" style={{width:'100%'}}>No data for this district yet.</div>}
              </div>
            )}
            <div style={{display:'flex',gap:'1.5rem',marginTop:'1rem',flexWrap:'wrap'}}>
              <span style={{fontSize:'.78rem',display:'flex',alignItems:'center',gap:'.4rem'}}><span style={{width:12,height:12,borderRadius:3,background:'var(--green-500)',display:'inline-block'}}/> &lt;17h — manageable</span>
              <span style={{fontSize:'.78rem',display:'flex',alignItems:'center',gap:'.4rem'}}><span style={{width:12,height:12,borderRadius:3,background:'var(--amber-500)',display:'inline-block'}}/> 17–20h — severe</span>
              <span style={{fontSize:'.78rem',display:'flex',alignItems:'center',gap:'.4rem'}}><span style={{width:12,height:12,borderRadius:3,background:'var(--red-500)',display:'inline-block'}}/> &gt;20h — critical</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>Citizen-Reported Grid Incidents</h2>
            <p style={{color:'var(--navy-500)',marginBottom:'1rem',fontSize:'.875rem'}}>Real-time issues logged by users across Lebanon.</p>

            <NearMeButton myDistrict={nearMe.myDistrict} detecting={nearMe.detecting} error={nearMe.error}
              onRequest={nearMe.requestLocation} onClear={nearMe.clear} />

            {(() => {
              const areaMatched = issues.filter(i => !nearMe.myDistrict || areaMatches(i.district, nearMe.myDistrict));
              const usingNearestFallback = nearMe.myDistrict && areaMatched.length === 0 && nearMe.myCoords;
              const visibleIssues = usingNearestFallback ? nearestItems(issues, nearMe.myCoords) : areaMatched;
              return loading ? <div className="spinner-wrap"><div className="spinner"/></div> : (<>
               {usingNearestFallback && (
                 <div style={{ background: '#eff6ff', color: '#1e40af', padding: '.7rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '.85rem', marginBottom: '1rem' }}>
                   No grid incidents found in "{nearMe.myDistrict}" specifically — showing the nearest ones by distance instead.
                 </div>
               )}
               {visibleIssues.length > 0 ? (
                <div className="card-grid">
                  {visibleIssues.map(i=>(
                    <div key={i.id} className="card">
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                        <SeverityPill value={i.severity}/>
                        <StatusPill value={i.status}/>
                      </div>
                      <h3>📍 {i.location_name}{usingNearestFallback && ` · ${i._distanceKm < 1 ? `${Math.round(i._distanceKm*1000)}m` : `${i._distanceKm.toFixed(1)}km`} away`}</h3>
                      <p style={{color:'var(--green-500)',fontWeight:600,fontSize:'.85rem',margin:'.35rem 0'}}>{i.problem_type}</p>
                      <p style={{fontSize:'.85rem',color:'var(--navy-500)'}}>{i.description}</p>
                      <small style={{color:'var(--gray-400)',display:'block',marginTop:'.65rem'}}>Reported by: <strong>{i.name||'Anonymous'}</strong></small>
                      <ConfirmButton report={i} />
                    </div>
                  ))}
                </div>
              ) : nearMe.myDistrict ? (
                <div className="empty-state">💡 No grid failures reported near {nearMe.myDistrict}.</div>
              ) : <div className="empty-state">💡 No grid failures reported for this cycle.</div>}
              </>);
            })()}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-header center"><h2>Frequently Asked Questions</h2></div>
          <div className="grid-2">
            {[
              ['When will power rationing end?','Schedules depend on generation capacity and fuel. Local provider updates are the most reliable source for exact timings.'],
              ['How do I report a power line issue?','Use the Report page. For immediate danger, contact Civil Defense at 125 first.'],
              ['What are the peak usage hours?','Demand peaks between 6 PM and 10 PM. Shifting heavy appliances outside this range helps the grid.'],
              ['Are solar alternatives available?','Several NGO and private initiatives support solar adoption. Start with the resources on the About page.'],
            ].map(([q,a])=>(
              <div key={q} className="panel">
                <h3 style={{marginBottom:'.5rem'}}>{q}</h3>
                <p style={{color:'var(--navy-500)',fontSize:'.9rem'}}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}