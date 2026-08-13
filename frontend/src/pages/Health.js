import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { getReports, getHealthFacilities } from '../services/api';
import ConfirmButton from '../components/ConfirmButton';

const API = '/api';
const FACILITY_TYPES = [
  { key: 'hospital', label: 'Hospitals',   color: '#ef4444', icon: '🏥' },
  { key: 'pharmacy', label: 'Pharmacies',  color: '#10b981', icon: '💊' },
  { key: 'clinic',   label: 'Clinics',     color: '#3b82f6', icon: '🏨' },
  { key: 'doctor',   label: 'Doctors',     color: '#f59e0b', icon: '👨‍⚕️' },
];
// OSM phone data sometimes has multiple numbers in one field, separated
// by ';' (e.g. "+9618635740;+9618635741"). Split and clean these into a
// proper list instead of displaying one long, unclickable string.
function splitPhones(phone) {
  if (!phone) return [];
  return phone.split(';').map(p => p.trim()).filter(Boolean);
}

// Standard haversine formula — straight-line distance in km between the
// citizen's position and a facility. Not driving distance, but a fast,
// dependency-free approximation that's accurate enough to sort/label cards.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// OSM sometimes tags multiple specialties on one clinic/doctor entry the
// same way it does phone numbers — semicolon-separated (e.g.
// "cardiology;dermatology"). Split and prettify each one for display.
function splitSpecialties(specialty) {
  if (!specialty) return [];
  return specialty.split(';').map(s => s.trim()).filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '));
}
// Default kept at 6km (unchanged existing behavior); 10/15km added per
// instructor feedback so citizens in less densely-covered areas can widen
// their search instead of getting an empty result.
const RADIUS_OPTIONS_KM = [6, 10, 15];

export default function Health() {
  const [facilities, setFacilities] = useState([]);
  const [activeType, setActiveType] = useState('hospital');
  const [userPos,    setUserPos]    = useState({ lat: 33.888, lng: 35.495 });
  const [loading,    setLoading]    = useState(false);
  const [located,    setLocated]    = useState(false);
  const [error,      setError]      = useState('');
  const [issues,     setIssues]     = useState([]);
  const [radiusKm,   setRadiusKm]   = useState(6);
  const [verifiedFacilities, setVerifiedFacilities] = useState([]);
  const [activeRegion, setActiveRegion] = useState('all');

  useEffect(() => {
    getReports({ category: 'health' }).then(r => setIssues(r.data.filter(i => i.status !== 'resolved'))).catch(() => {});
    getHealthFacilities().then(r => setVerifiedFacilities(r.data)).catch(() => {});
  }, []);

  // Get user location then fetch nearby facilities
  const locate = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation not supported by your browser.'); return; }
    setLoading(true); setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setUserPos({ lat, lng });
        setLocated(true);
        fetchFacilities(lat, lng, activeType, radiusKm);
      },
      () => {
        setError('Could not get your location. Showing results for Beirut.');
        fetchFacilities(33.888, 35.495, activeType, radiusKm);
        setLocated(true);
      },
      { timeout: 8000 }
    );
  }, [activeType, radiusKm]);

  // Guards against a real race condition: a larger-radius search takes
  // longer to respond, so switching quickly from 15km back to 6km could
  // let the slower 15km response arrive AFTER the faster 6km one and
  // silently overwrite it with stale, wrong-radius results. This ref
  // tracks which request is the most recent; any response that isn't
  // from the latest request is simply discarded.
  const latestRequestId = React.useRef(0);

  const fetchFacilities = useCallback(async (lat, lng, type, km) => {
    const requestId = ++latestRequestId.current;
    setLoading(true); setFacilities([]); setError('');

    const attempt = () => axios.get(`${API}/health/nearby?lat=${lat}&lng=${lng}&type=${type}&radius=${km * 1000}`);

    try {
      let r = await attempt();
      // The free public Overpass API occasionally returns an empty result
      // on a "cold" first request (no API key, shared/rate-limited server).
      // A single quick retry wasn't always enough margin, so this tries up
      // to 3 total attempts with increasing waits before accepting an empty
      // result as genuine — still fails soft to "no results" if all 3 come
      // back empty, it just gives the upstream service more real chances.
      const delays = [1000, 2000, 3000, 4000];
      for (const delay of delays) {
        if (r.data.length > 0) break;
        await new Promise(resolve => setTimeout(resolve, delay));
        if (requestId !== latestRequestId.current) return; // superseded while waiting
        r = await attempt();
      }
      if (requestId !== latestRequestId.current) return; // a newer request has since started — discard this stale response
      setFacilities(r.data);
    } catch {
      if (requestId !== latestRequestId.current) return;
      setError('Could not load nearby facilities. Please try again.');
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, []);

  const changeType = (type) => {
    setActiveType(type);
    if (located) fetchFacilities(userPos.lat, userPos.lng, type, radiusKm);
  };

  const changeRadius = (km) => {
    setRadiusKm(km);
    if (located) fetchFacilities(userPos.lat, userPos.lng, activeType, km);
  };

  const typeInfo = FACILITY_TYPES.find(t => t.key === activeType);

  // Regions derived from the actual verified facilities returned by the
  // API — not hardcoded — so this stays correct automatically as staff
  // add facilities in new areas, with no code change needed here.
  const availableRegions = [...new Set(verifiedFacilities.map(f => f.area).filter(Boolean))].sort();
  const displayedVerifiedFacilities = activeRegion === 'all'
    ? verifiedFacilities
    : verifiedFacilities.filter(f => f.area === activeRegion);

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">❤</div>
            <div>
              <h1>Health Services</h1>
              <p>Emergency numbers, live nearby facilities based on your location, and health guidance.</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{background:'var(--navy-800)',padding:'1.25rem 0'}}>
        <div className="container">
          <div style={{display:'flex',gap:'2rem',flexWrap:'wrap'}}>
            {[
              ['Staff-Verified Facilities', verifiedFacilities.length, '#fff'],
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

      {/* Emergency numbers */}
      <section style={{background:'var(--navy-800)',padding:'1.5rem 0'}}>
        <div className="container">
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:'1rem'}}>
            {[['🚑 Ambulance','Red Cross','140'],['🛡 Civil Defense','Emergency','125'],['🏥 Medical EMS','Ministry','1701'],['🔥 Fire Dept','National','175']].map(([icon,label,num])=>(
              <a key={num} href={`tel:${num}`} style={{background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'var(--radius-md)',padding:'1rem 1.25rem',color:'var(--white)',display:'block',textDecoration:'none',transition:'background .15s'}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(16,185,129,.15)'}
                onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.06)'}>
                <div style={{fontSize:'.78rem',color:'var(--gray-400)',marginBottom:'.25rem'}}>{icon} {label}</div>
                <strong style={{fontSize:'1.8rem',fontFamily:'var(--font-mono)',color:'var(--green-400)'}}>{num}</strong>
                <div style={{fontSize:'.7rem',color:'var(--gray-400)',marginTop:'.25rem'}}>Tap to call</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Live facility finder */}
      <section className="section">
        <div className="container">
          <div className="panel">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'1rem',marginBottom:'1.5rem'}}>
              <div>
                <h2 style={{marginBottom:'.35rem'}}>Nearby Health Facilities</h2>
                <p style={{color:'var(--navy-500)',fontSize:'.875rem'}}>
                  Live data from OpenStreetMap — hospitals, pharmacies, clinics, and doctors near you.
                </p>
                <p style={{color:'var(--gray-400)',fontSize:'.75rem',marginTop:'.3rem'}}>
                  Facility details (phone, hours, specialties) are community-contributed and may be incomplete for some areas.
                </p>
              </div>
              <button className="btn btn-primary" onClick={locate} disabled={loading}>
                {loading ? '🔍 Searching…' : located ? '🔄 Refresh' : '📍 Find Near Me'}
              </button>
            </div>

            {/* Type filter tabs */}
            <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginBottom:'1rem'}}>
              {FACILITY_TYPES.map(t=>(
                <button key={t.key}
                  onClick={()=>changeType(t.key)}
                  style={{
                    padding:'.4rem 1rem', borderRadius:999, border:'1.5px solid',
                    fontSize:'.82rem', fontWeight:600, cursor:'pointer', transition:'all .15s',
                    borderColor: activeType===t.key ? t.color : 'var(--gray-300)',
                    background:  activeType===t.key ? t.color : 'var(--white)',
                    color:       activeType===t.key ? '#fff'  : 'var(--navy-600)',
                  }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Radius selector — per instructor feedback, citizens can widen
                their search beyond the default 6km if nothing nearby turns up */}
            <div style={{display:'flex',gap:'.5rem',alignItems:'center',flexWrap:'wrap',marginBottom:'1.25rem'}}>
              <span style={{fontSize:'.8rem',color:'var(--navy-500)',fontWeight:600}}>Search radius:</span>
              {RADIUS_OPTIONS_KM.map(km=>(
                <button key={km}
                  onClick={()=>changeRadius(km)}
                  style={{
                    padding:'.3rem .85rem', borderRadius:999, border:'1.5px solid',
                    fontSize:'.78rem', fontWeight:600, cursor:'pointer', transition:'all .15s',
                    borderColor: radiusKm===km ? 'var(--green-500)' : 'var(--gray-300)',
                    background:  radiusKm===km ? 'var(--green-500)' : 'var(--white)',
                    color:       radiusKm===km ? '#fff' : 'var(--navy-600)',
                  }}>
                  {km}km
                </button>
              ))}
            </div>

            {error && <div className="feedback-err" style={{marginBottom:'1rem'}}>{error}</div>}

            {!located && !loading && (
              <div className="empty-state" style={{border:'1.5px dashed var(--gray-300)',borderRadius:'var(--radius-lg)',padding:'3rem'}}>
                <div style={{fontSize:'2.5rem',marginBottom:'.75rem'}}>📍</div>
                <p style={{fontStyle:'normal',fontWeight:600,color:'var(--navy-600)',marginBottom:'.5rem'}}>Allow location to find nearby facilities</p>
                <p style={{fontSize:'.875rem'}}>Click "Find Near Me" to discover hospitals, pharmacies, and clinics in your area using live OpenStreetMap data.</p>
              </div>
            )}

            {located && (
              <>
                {/* Map */}
                <div style={{height:380,borderRadius:'var(--radius-lg)',overflow:'hidden',border:'1px solid var(--gray-200)',marginBottom:'1.25rem'}}>
                  <MapContainer center={[userPos.lat, userPos.lng]} zoom={14} style={{height:'100%',width:'100%'}}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap contributors'/>
                    {/* User position */}
                    <CircleMarker center={[userPos.lat,userPos.lng]} radius={10}
                      pathOptions={{fillColor:'#3b82f6',color:'#fff',weight:3,fillOpacity:1}}>
                      <Popup><strong>Your location</strong></Popup>
                    </CircleMarker>
                    {/* Facilities */}
                    {facilities.map(f=>(
                      <CircleMarker key={f.id} center={[f.lat,f.lng]} radius={9}
                        pathOptions={{fillColor:typeInfo?.color||'#10b981',color:'#fff',weight:2,fillOpacity:.85}}>
                        <Popup>
                          <div style={{fontWeight:700,marginBottom:'.25rem'}}>{f.name}</div>
                          {f.address && <div style={{fontSize:'.8rem',color:'#475569'}}>{f.address}</div>}
                          {f.phone && (
                            <div style={{fontSize:'.8rem',marginTop:'.3rem'}}>
                              📞 {splitPhones(f.phone).map((num, i) => (
                                <React.Fragment key={num}>
                                  {i > 0 && ', '}
                                  <a href={`tel:${num}`}>{num}</a>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                          {f.opening && <div style={{fontSize:'.78rem',color:'#64748b',marginTop:'.25rem'}}>🕐 {f.opening}</div>}
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>

                {/* List — sorted closest-first once we know the user's position */}
                {loading ? <div className="spinner-wrap"><div className="spinner"/></div> :
                 facilities.length > 0 ? (
                  <div className="card-grid">
                    {[...facilities]
                      .map(f => ({ ...f, _distanceKm: distanceKm(userPos.lat, userPos.lng, f.lat, f.lng) }))
                      .sort((a, b) => a._distanceKm - b._distanceKm)
                      .slice(0, 12)
                      .map(f => (
                      <div key={f.id} className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'.5rem',gap:'.5rem'}}>
                          <h3 style={{margin:0,fontSize:'.95rem'}}>{f.name}</h3>
                          <span style={{fontSize:'1.3rem',flexShrink:0}}>{typeInfo?.icon}</span>
                        </div>

                        <span className="pill" style={{background:'#eff6ff',color:'#1e40af',fontSize:'.72rem',marginBottom:'.5rem',display:'inline-block'}}>
                          📏 {f._distanceKm < 1 ? `${Math.round(f._distanceKm * 1000)} m away` : `${f._distanceKm.toFixed(1)} km away`}
                        </span>

                        {splitSpecialties(f.specialty).length > 0 && (
                          <div style={{display:'flex',gap:'.35rem',flexWrap:'wrap',marginBottom:'.6rem'}}>
                            {splitSpecialties(f.specialty).map(spec => (
                              <span key={spec} className="pill" style={{background:'#f0fdf4',color:'#166534',fontSize:'.7rem'}}>
                                {spec}
                              </span>
                            ))}
                          </div>
                        )}

                        {f.address && <p style={{fontSize:'.8rem',marginBottom:'.4rem',color:'var(--navy-500)'}}>📍 {f.address}</p>}

                        {f.phone && (
                          <p style={{fontSize:'.8rem',marginBottom:'.4rem'}}>
                            📞 {splitPhones(f.phone).map((num, i) => (
                              <React.Fragment key={num}>
                                {i > 0 && ', '}
                                <a href={`tel:${num}`} style={{color:'var(--green-500)'}}>{num}</a>
                              </React.Fragment>
                            ))}
                          </p>
                        )}

                        {f.opening && <p style={{fontSize:'.78rem',color:'var(--gray-400)',marginBottom:'.6rem'}}>🕐 {f.opening}</p>}

                        <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginTop:'.6rem',paddingTop:'.6rem',borderTop:'1px solid var(--gray-100)'}}>
                          <a href={`https://www.google.com/maps/dir/?api=1&origin=${userPos.lat},${userPos.lng}&destination=${f.lat},${f.lng}`}
                            target="_blank" rel="noopener noreferrer"
                            className="btn btn-sm btn-secondary" style={{textDecoration:'none',fontSize:'.78rem'}}>
                            🧭 Directions
                          </a>
                          {f.website && (
                            <a href={f.website} target="_blank" rel="noopener noreferrer"
                              className="btn btn-sm btn-secondary" style={{textDecoration:'none',fontSize:'.78rem'}}>
                              🌐 Website
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No {typeInfo?.label.toLowerCase()} found within {radiusKm}km. Try widening your search radius or a different category.</div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Guidance cards */}
      <section className="section section-alt">
        <div className="container">
          <div className="section-header center"><h2>Essential Health Guidance</h2></div>
          <div className="card-grid">
            {[
              {title:'Emergency Response',tag:'Urgent',items:['Call the nearest emergency number for life-threatening situations.','Share your exact area, nearby landmark, and patient condition.','Keep one family member available for follow-up calls.']},
              {title:'Hospital Access',tag:'Care',items:['Confirm emergency intake before long-distance travel when possible.','Carry ID, medication lists, allergies, and prior records.','Prepare a backup route in case of road closures.']},
              {title:'Medicine Availability',tag:'Pharmacy',items:['Refill essential prescriptions before they run low.','Keep generic medicine names written down, not only brand names.','Store temperature-sensitive medicine correctly.']},
              {title:'Power Outage Prep',tag:'Preparedness',items:['Charge medical devices whenever electricity is available.','Keep a small kit: water, masks, first-aid supplies.','Check refrigeration needs for insulin or sensitive medications.']},
            ].map(c=>(
              <div key={c.title} className="card">
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                  <h3 style={{margin:0}}>{c.title}</h3>
                  <span className="pill pill-reviewed" style={{fontSize:'.68rem'}}>{c.tag}</span>
                </div>
                <ul style={{paddingLeft:'1.1rem',display:'flex',flexDirection:'column',gap:'.45rem'}}>
                  {c.items.map(it=><li key={it} style={{fontSize:'.855rem',color:'var(--navy-500)'}}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* Staff-verified health facilities — org-entered data, meant as a
          genuine supplement to the live OSM scan above. This section was
          designed from the very first post-pivot handoff but never had a
          citizen-facing endpoint until now, so it never actually appeared
          here despite being fully built and populated on the staff side. */}
      <section className="section">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>✓ Staff-Verified Health Facilities</h2>
            <p style={{color:'var(--navy-500)',margin:'.5rem 0 1.25rem',fontSize:'.875rem'}}>
              Entered and maintained directly by municipal staff — a reliable supplement where live map data may be incomplete.
            </p>
            {availableRegions.length > 1 && (
              <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginBottom:'1.1rem'}}>
                <button
                  className={`btn btn-sm ${activeRegion === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActiveRegion('all')}
                >
                  All
                </button>
                {availableRegions.map(region => (
                  <button
                    key={region}
                    className={`btn btn-sm ${activeRegion === region ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setActiveRegion(region)}
                  >
                    {region}
                  </button>
                ))}
              </div>
            )}
            {displayedVerifiedFacilities.length > 0 ? (
              <div className="card-grid">
                {displayedVerifiedFacilities.map(f => (
                  <div key={f.id} className="card">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'.5rem',gap:'.5rem'}}>
                      <h3 style={{margin:0,fontSize:'.95rem'}}>{f.name}</h3>
                      {f.status && <span className={`pill pill-${f.status}`} style={{flexShrink:0}}>{f.status}</span>}
                    </div>
                    <span className="pill" style={{background:'#f0fdf4',color:'#166534',fontSize:'.72rem',marginBottom:'.5rem',display:'inline-block'}}>
                      ✓ Verified by {f.organization_name}
                    </span>
                    <p style={{fontSize:'.8rem',marginBottom:'.4rem',color:'var(--navy-500)'}}>
                      📍 {f.area}{f.facility_type ? ` · ${f.facility_type}` : ''}
                    </p>
                    {f.landmark_note && (
                      <p style={{fontSize:'.78rem',color:'var(--gray-400)',marginBottom:'.5rem',fontStyle:'italic'}}>{f.landmark_note}</p>
                    )}
                    <a href={`https://www.google.com/maps/dir/?api=1&${located ? `origin=${userPos.lat},${userPos.lng}&` : ''}destination=${f.latitude},${f.longitude}`}
                      target="_blank" rel="noopener noreferrer"
                      className="btn btn-sm btn-secondary" style={{textDecoration:'none',fontSize:'.78rem',marginTop:'.4rem',display:'inline-block'}}>
                      🧭 Directions
                    </a>
                  </div>
                ))}
              </div>
            ) : <div className="empty-state">
                  {activeRegion === 'all'
                    ? 'No staff-verified facilities entered yet for your area.'
                    : `No staff-verified facilities entered yet for ${activeRegion}.`}
                </div>}
          </div>
        </div>
      </section>

      {/* Citizen-reported health issues, matching the pattern on other category pages */}
      <section className="section">
        <div className="container">
          <div className="panel">
            <h2 style={{marginBottom:'.5rem'}}>📢 Citizen-Reported Health Issues</h2>
            <p style={{color:'var(--navy-500)',margin:'.5rem 0 1.25rem',fontSize:'.875rem'}}>Crowdsourced reports about health facility issues — shortages, closures, access problems.</p>
            {issues.length > 0 ? (
              <div className="card-grid">
                {issues.map(i=>(
                  <div key={i.id} className="card">
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'.65rem'}}>
                      <span className={`pill pill-${i.severity}`}>{i.problem_type}</span>
                      <small style={{color:'var(--gray-400)',fontFamily:'var(--font-mono)',fontSize:'.7rem'}}>LIVE</small>
                    </div>
                    <h3>📍 {i.location_name}</h3>
                    <p style={{marginTop:'.35rem',fontSize:'.875rem'}}>"{i.description}"</p>
                    <small style={{color:'var(--gray-400)',display:'block',marginTop:'.65rem'}}>By: <strong>{i.name||'Anonymous'}</strong></small>
                    <ConfirmButton report={i} />
                  </div>
                ))}
              </div>
            ) : <div className="empty-state">🟢 No health facility issues reported at this time.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}