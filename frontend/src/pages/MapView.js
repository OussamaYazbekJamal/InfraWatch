import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { getMapPoints, getFuelMapPoints, confirmReport, getFuelBrands, getOffices, getHealthFacilities } from '../services/api';
import { useAuth } from '../context/AuthContext';
import SeverityPill from '../components/SeverityPill';
import '../styles/map.css';

const SEV_COLOR = { low:'#10b981', medium:'#f59e0b', high:'#ef4444', critical:'#1a1a2e' };
const FUEL_COLOR = { available:'#10b981', limited:'#f59e0b', closed:'#ef4444' };
const OFFICE_COLOR = '#7c3aed';
const HEALTH_COLOR = '#db2777';
const FILTERS = ['All','Electricity','Fuel','Roads','Transportation','Offices','Health','Fuel Stations'];

// Multiple reports/stations at (or very near) the same coordinates would
// otherwise render as perfectly stacked circle markers - only the top one
// is visible or clickable. This groups items by rounded coordinates and, for
// any group with more than one item, fans them out in a small circle around
// the original point so every pin stays visible and clickable. Purely a
// display adjustment - the real latitude/longitude are never changed or sent
// back to the server.
function fanOutOverlapping(items, { latKey = 'latitude', lngKey = 'longitude' } = {}) {
  const groups = {};
  items.forEach((item) => {
    const lat = parseFloat(item[latKey]);
    const lng = parseFloat(item[lngKey]);
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`; // ~11m precision
    (groups[key] = groups[key] || []).push({ item, lat, lng });
  });

  const result = [];
  Object.values(groups).forEach((group) => {
    if (group.length === 1) {
      const { item, lat, lng } = group[0];
      result.push({ ...item, _lat: lat, _lng: lng });
      return;
    }
    const OFFSET_DEG = 0.0006; // roughly 60-70m fan-out radius
    const angleStep = (2 * Math.PI) / group.length;
    group.forEach(({ item, lat, lng }, i) => {
      const angle = i * angleStep;
      result.push({
        ...item,
        _lat: lat + OFFSET_DEG * Math.cos(angle),
        _lng: lng + OFFSET_DEG * Math.sin(angle),
      });
    });
  });
  return result;
}

function ConfirmBlock({ report, onConfirmed }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg,  setMsg]  = useState(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await confirmReport(report.id);
      onConfirmed(report.id, data.confirmation_count);
      setMsg({ type: 'ok', text: 'Thanks — confirmed.' });
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Failed to confirm' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nlp-result" style={{ borderColor: '#10b981' }}>
      <strong>✅ Still happening?</strong>
      <span>
        {report.confirmation_count > 0
          ? `Confirmed by ${report.confirmation_count} ${report.confirmation_count===1?'person':'people'}.`
          : 'Be the first to confirm this is still an issue.'}
      </span>
      {user ? (
        <div style={{ marginTop:'.4rem' }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop:'.4rem', fontSize:'.78rem', color:'#64748b' }}>
          <Link to="/login">Sign in</Link> to confirm this report.
        </div>
      )}
      {msg && (
        <div style={{ marginTop:'.35rem', fontSize:'.78rem', color: msg.type==='ok' ? '#059669' : '#dc2626' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

export default function MapView() {
  const [reports,     setReports]     = useState([]);
  const [stations,    setStations]    = useState([]);
  const [offices,     setOffices]     = useState([]);
  const [healthFacilities, setHealthFacilities] = useState([]);
  const [filter,      setFilter]      = useState('All');
  const [loading,     setLoading]     = useState(true);
  const [fuelBrands,  setFuelBrands]  = useState([]);
  const [brandFilter, setBrandFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const [r,s,b,o,h] = await Promise.all([
        getMapPoints(), getFuelMapPoints(), getFuelBrands(), getOffices(), getHealthFacilities(),
      ]);
      setReports(r.data); setStations(s.data); setFuelBrands(b.data);
      setOffices(o.data); setHealthFacilities(h.data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleConfirmed = (reportId, newCount) => {
    setReports(prev => prev.map(r => r.id===reportId ? { ...r, confirmation_count: newCount } : r));
  };

  const filtered = reports.filter(r => {
    if (filter === 'All' || filter === 'Fuel Stations') {
      if (filter === 'Fuel Stations') return false;
    } else if (r.category?.toLowerCase() !== filter.toLowerCase()) {
      return false;
    }
    if (districtFilter !== 'all' && r.matched_jurisdiction !== districtFilter) return false;
    return true;
  });

  // Derived client-side from whatever reports are loaded, but based on
  // matched_jurisdiction (the real organization's jurisdiction string,
  // matched server-side via the same normalize_geo_text logic used for
  // Staff/Lead's jurisdiction view) rather than raw report.district.
  // This naturally dedupes accent/script variants of the same place (e.g.
  // "Zahle District" vs "Zahlé District" both resolve to one org's actual
  // jurisdiction label) and drops legacy reports that fall outside all 3
  // demo regions from the filter list — they're out of this project's
  // demo scope, but still appear as markers under "All", just without a
  // dedicated (and likely unrecognizable, e.g. Arabic-script) filter chip.
  const districts = Array.from(new Set(reports.map(r => r.matched_jurisdiction).filter(Boolean))).sort();

  const filteredStations = brandFilter==='all' ? stations : stations.filter(s=>s.brand===brandFilter);

  // Some staff-entered offices/health facilities may not have coordinates
  // filled in yet (e.g. created before the map-click picker was used) —
  // filter those out rather than crashing the map trying to plot them.
  const mappableOffices = offices.filter(o => o.latitude && o.longitude);
  const mappableHealth  = healthFacilities.filter(h => h.latitude && h.longitude);

  const fannedReports  = fanOutOverlapping(filtered);
  const fannedStations = fanOutOverlapping(filteredStations);
  const fannedOffices  = fanOutOverlapping(mappableOffices);
  const fannedHealth   = fanOutOverlapping(mappableHealth);

  // Which entity layers are actually visible under the current filter —
  // drives both which markers render AND which legend items show, so the
  // legend always reflects what's actually on screen instead of a fixed
  // list that includes irrelevant items regardless of the current view.
  const showReports  = filter !== 'Fuel Stations';
  const showFuel     = filter === 'All' || filter === 'Fuel Stations';
  const showOffices  = filter === 'All' || filter === 'Offices';
  const showHealth   = filter === 'All' || filter === 'Health';

  return (
    <main>
      <section className="map-page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">🗺</div>
            <div>
              <h1>Live Infrastructure Map</h1>
              <p>All citizen reports and fuel stations across Lebanon — colored by severity.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="map-controls">
            {FILTERS.map(f=>(
              <button key={f} className={`map-filter-btn ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>{f}</button>
            ))}
            <span style={{marginLeft:'auto',fontSize:'.82rem',color:'var(--navy-500)'}}>
              {showReports && `${filtered.length} report${filtered.length!==1?'s':''}`}
              {showFuel && ` · ${stations.length} stations`}
              {showOffices && ` · ${mappableOffices.length} offices`}
              {showHealth && ` · ${mappableHealth.length} health facilities`}
            </span>
          </div>

          {showFuel && fuelBrands.length > 0 && (
            <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:'.8rem',color:'var(--navy-500)',fontWeight:600}}>Fuel brand:</span>
              <button onClick={()=>setBrandFilter('all')}
                className={`map-filter-btn ${brandFilter==='all'?'active':''}`}>All</button>
              {fuelBrands.map(b=>(
                <button key={b} onClick={()=>setBrandFilter(b)}
                  className={`map-filter-btn ${brandFilter===b?'active':''}`}>{b}</button>
              ))}
            </div>
          )}

          {districts.length > 0 && (
            <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:'.8rem',color:'var(--navy-500)',fontWeight:600}}>Region:</span>
              <button onClick={()=>setDistrictFilter('all')}
                className={`map-filter-btn ${districtFilter==='all'?'active':''}`}>All</button>
              {districts.map(d=>(
                <button key={d} onClick={()=>setDistrictFilter(d)}
                  className={`map-filter-btn ${districtFilter===d?'active':''}`}>{d}</button>
              ))}
            </div>
          )}

          {loading ? <div className="spinner-wrap"><div className="spinner"/></div> : (
            <div className="map-wrap">
              <MapContainer center={[33.888,35.495]} zoom={9} style={{height:'100%',width:'100%'}}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'/>
                {showReports && fannedReports.map(r=>(
                  <CircleMarker key={r.id}
                    center={[r._lat, r._lng]}
                    radius={10}
                    pathOptions={{ fillColor:SEV_COLOR[r.severity]||'#94a3b8', color:'#fff', weight:2, fillOpacity:.88 }}>
                    <Popup minWidth={240}>
                      <div className="popup-title">{r.location_name}</div>
                      <div className="popup-type">{r.category} · {r.problem_type}</div>
                      {(r.matched_jurisdiction || r.district) && (
                        <div style={{fontSize:'.75rem',color:'#64748b',marginTop:'.15rem'}}>📍 {r.matched_jurisdiction || r.district}</div>
                      )}
                      <SeverityPill value={r.severity}/>
                      {r.fuel_station_name && (
                        <div style={{marginTop:'.35rem',fontSize:'.78rem',color:'#0f172a',fontWeight:600}}>
                          ⛽ {r.fuel_station_name} ({r.fuel_station_brand})
                        </div>
                      )}
                      <div style={{marginTop:'.5rem',fontSize:'.78rem',color:'#475569'}}>{new Date(r.created_at).toLocaleDateString()}</div>
                      <ConfirmBlock report={r} onConfirmed={handleConfirmed}/>
                    </Popup>
                  </CircleMarker>
                ))}
                {showFuel && fannedStations.map(s=>(
                  <CircleMarker key={s.id}
                    center={[s._lat, s._lng]}
                    radius={8}
                    pathOptions={{ fillColor:FUEL_COLOR[s.status]||'#94a3b8', color:'#fff', weight:2, fillOpacity:.75, dashArray:'4 2' }}>
                    <Popup>
                      <div className="popup-title">{s.name}</div>
                      <div className="popup-type">{s.area}{s.brand ? ` · ${s.brand}` : ''}</div>
                      <span className={`pill pill-${s.status}`}>{s.status}</span>
                      {s.landmark_note && (
                        <div style={{marginTop:'.4rem',fontSize:'.78rem',color:'#64748b',fontStyle:'italic'}}>{s.landmark_note}</div>
                      )}
                      {s.diesel_price && (
                        <div style={{marginTop:'.5rem',fontSize:'.8rem'}}>Diesel: ${s.diesel_price} · Gasoline: ${s.gasoline_price}</div>
                      )}
                    </Popup>
                  </CircleMarker>
                ))}
                {showOffices && fannedOffices.map(o=>(
                  <CircleMarker key={`office-${o.id}`}
                    center={[o._lat, o._lng]}
                    radius={8}
                    pathOptions={{ fillColor:OFFICE_COLOR, color:'#fff', weight:2, fillOpacity:.8 }}>
                    <Popup>
                      <div className="popup-title">{o.name}</div>
                      <div className="popup-type">{o.area}{o.office_type ? ` · ${o.office_type}` : ''}</div>
                      {o.status && <span className={`pill pill-${o.status}`}>{o.status}</span>}
                      {o.landmark_note && (
                        <div style={{marginTop:'.4rem',fontSize:'.78rem',color:'#64748b',fontStyle:'italic'}}>{o.landmark_note}</div>
                      )}
                    </Popup>
                  </CircleMarker>
                ))}
                {showHealth && fannedHealth.map(h=>(
                  <CircleMarker key={`health-${h.id}`}
                    center={[h._lat, h._lng]}
                    radius={8}
                    pathOptions={{ fillColor:HEALTH_COLOR, color:'#fff', weight:2, fillOpacity:.8 }}>
                    <Popup>
                      <div className="popup-title">{h.name}</div>
                      <div className="popup-type">{h.area}{h.facility_type ? ` · ${h.facility_type}` : ''}</div>
                      {h.status && <span className={`pill pill-${h.status}`}>{h.status}</span>}
                      {h.organization_name && (
                        <div style={{marginTop:'.4rem',fontSize:'.75rem',color:'#166534'}}>✓ Verified by {h.organization_name}</div>
                      )}
                      {h.landmark_note && (
                        <div style={{marginTop:'.4rem',fontSize:'.78rem',color:'#64748b',fontStyle:'italic'}}>{h.landmark_note}</div>
                      )}
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          )}

          <div className="map-legend">
            {showReports && [['#10b981','Low severity'],['#f59e0b','Medium'],['#ef4444','High'],['#1a1a2e','Critical']].map(([c,l])=>(
              <div key={l} className="legend-item"><div className="legend-dot" style={{background:c}}/>{l}</div>
            ))}
            {showFuel && (
              <>
                <div className="legend-item"><div className="legend-dot" style={{background:'#10b981',outline:'2px dashed #065f46'}}/> Fuel (available)</div>
                <div className="legend-item"><div className="legend-dot" style={{background:'#f59e0b',outline:'2px dashed #92400e'}}/> Fuel (limited)</div>
              </>
            )}
            {showOffices && (
              <div className="legend-item"><div className="legend-dot" style={{background:OFFICE_COLOR}}/> Government Offices</div>
            )}
            {showHealth && (
              <div className="legend-item"><div className="legend-dot" style={{background:HEALTH_COLOR}}/> Health Facilities</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}