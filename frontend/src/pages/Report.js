import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { createReport, classifyText, extractLocationHint, classifyImage, getFuelStations, getOffices, getApprovedJurisdictions } from '../services/api';
import { useAuth } from '../context/AuthContext';
import '../styles/report.css';
import '../styles/auth.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const CATEGORIES = {
  electricity:    ['Power Outage','Damaged Power Line','Transformer Malfunction','Streetlight Failure'],
  fuel:           ['Out of Fuel','Long Queues','Station Closed','Price Discrepancy'],
  roads:          ['Pothole','Surface Damage','Flooding','Collapsed Section','Cracks','Missing Signage'],
  transportation: ['Service Delay','Facility Closed'],
  offices:        ['No Staff Present','Office Closed'],
  health:         ['Facility Closed','No Staff Present','Medicine Shortage','Long Wait Times'],
};

const LOCATION_MISMATCH_THRESHOLD_KM = 15; // same threshold used server-side in reportsController.js

const PHOTO_REQUIRED_TYPES = new Set(['Pothole', 'Cracks']);

const IMAGE_LABEL_TO_PROBLEM_TYPE = {
  pothole: { category: 'roads', problem_type: 'Pothole' },
  crack: { category: 'roads', problem_type: 'Cracks' },
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Independent of the ML model entirely — a deterministic keyword check for
// high-stakes locations (schools, hospitals, etc). The text classifier can
// be confidently wrong (see: a "low severity, 85% confidence" call on a
// pothole in front of a school), so this never overrides or hides the
// model's actual output — it adds a separate, always-visible warning next
// to it, so a low AI severity estimate near a vulnerable location can't
// slip through unchallenged just because the model missed it.
const HIGH_STAKES_KEYWORDS = [
  'school', 'kindergarten', 'nursery', 'hospital', 'clinic',
  'madraset', 'madrase', 'madrasa', 'mustashfa', 'mustashfeh', '3iyadeh', 'aiadeh',
  'مدرسة', 'مستشفى', 'عيادة', 'حضانة',
];

function containsHighStakesKeyword(text) {
  const lower = text.toLowerCase();
  return HIGH_STAKES_KEYWORDS.some(kw => lower.includes(kw));
}

// Groups a list of stations/offices by their 'area' field, sorted
// alphabetically by area, then by name within each group. Used to make the
// picker dropdowns scale as more regions/orgs are added — a flat list is
// fine at ~6 entries, but becomes unusable once several regions each have
// multiple stations/offices.
function groupByArea(items) {
  const groups = {};
  items.forEach(item => {
    const area = item.area || 'Other';
    (groups[area] = groups[area] || []).push(item);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, list]) => [area, list.sort((a, b) => a.name.localeCompare(b.name))]);
}

function PinMarker({ onPin }) {
  useMapEvents({ click(e) { onPin(e.latlng); } });
  return null;
}

export default function Report() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    category:'', problem_type:'', description:'',
    location_name:'', latitude:'', longitude:'', severity:'medium', image:null,
    fuel_station_id: '', government_office_id: '', region: '',
  });
  const [pin,        setPin]        = useState(null);
  const [nlpHint,    setNlpHint]    = useState(null);
  const [nlpLoading, setNlpLoading] = useState(false);
  const [locationHint,    setLocationHint]    = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [imageHint,    setImageHint]    = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [fuelStations, setFuelStations] = useState([]);
  const [offices,      setOffices]      = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [feedback,   setFeedback]   = useState('');
  const [error,      setError]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nlpTimer = useRef(null);
  const locationTimer = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Populates the required "Which region is this in?" dropdown — this
  // guarantees jurisdiction routing is 100% reliable (exact string match
  // against an approved org's jurisdiction), rather than depending on
  // GPS reverse-geocoding, which has real fuzzy-matching edge cases that
  // have been found and fixed repeatedly but can never be made fully
  // guaranteed given it relies on a free third-party geocoding service.
  useEffect(() => {
    getApprovedJurisdictions().then(r => setJurisdictions(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.description.length < 12) { setNlpHint(null); return; }
    clearTimeout(nlpTimer.current);
    nlpTimer.current = setTimeout(async () => {
      setNlpLoading(true);
      try {
        const { data } = await classifyText(form.description);
        if (data.severity) setNlpHint(data);
      } catch {}
      finally { setNlpLoading(false); }
    }, 700);
    return () => clearTimeout(nlpTimer.current);
  }, [form.description]);

  useEffect(() => {
    if (form.description.length < 12) { setLocationHint(null); return; }
    clearTimeout(locationTimer.current);
    locationTimer.current = setTimeout(async () => {
      setLocationLoading(true);
      try {
        const { data } = await extractLocationHint(form.description);
        const matches = data.matches || [];

        const ambiguousMatch = matches.find((m) => m.ambiguous);
        if (ambiguousMatch) {
          setLocationHint({
            type: 'ambiguous',
            mentionedPlace: ambiguousMatch.matched_name,
            candidates: [
              { lat: ambiguousMatch.lat, lon: ambiguousMatch.lon, place_type: ambiguousMatch.place_type },
              ...ambiguousMatch.alternative_candidates,
            ],
          });
          return;
        }

        const bestMatch = matches.find((m) => m.lat != null && m.lon != null && !m.ambiguous);
        if (bestMatch) {
          if (!pin) {
            setLocationHint({
              type: 'suggestion',
              mentionedPlace: bestMatch.matched_name,
              lat: bestMatch.lat,
              lon: bestMatch.lon,
            });
            return;
          }
          const distance = haversineKm(pin.lat, pin.lng, bestMatch.lat, bestMatch.lon);
          if (distance > LOCATION_MISMATCH_THRESHOLD_KM) {
            setLocationHint({
              type: 'mismatch',
              mentionedPlace: bestMatch.matched_name,
              lat: bestMatch.lat,
              lon: bestMatch.lon,
              distanceKm: Math.round(distance * 10) / 10,
            });
            return;
          }
        }
        setLocationHint(null);
      } catch {}
      finally { setLocationLoading(false); }
    }, 700);
    return () => clearTimeout(locationTimer.current);
  }, [form.description, pin]);

  // Load fuel stations for the picker only when category is fuel — no need
  // to fetch this list for every report type.
  useEffect(() => {
    if (form.category !== 'fuel') return;
    getFuelStations().then(({ data }) => setFuelStations(data)).catch(() => {});
  }, [form.category]);

  // Same pattern — only fetch offices when that category is selected.
  useEffect(() => {
    if (form.category !== 'offices') return;
    getOffices().then(({ data }) => setOffices(data)).catch(() => {});
  }, [form.category]);

  // Guard — must be logged in
  if (!user) {
    return (
      <main>
        <section className="page-hero">
          <div className="container">
            <div className="page-title">
              <div className="icon-badge">📢</div>
              <div><h1>Report an Issue</h1><p>Submit an infrastructure problem in your area.</p></div>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container" style={{ maxWidth: 560, marginTop: '1rem' }}>
            <div className="auth-gate">
              <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🔒</div>
              <h3>Sign in to submit a report</h3>
              <p>You need an account to report infrastructure issues. It only takes a minute to create one — it's completely free.</p>
              <div className="btn-row">
                <Link className="btn btn-primary" to="/login">Sign in</Link>
                <Link className="btn btn-secondary" to="/register">Create account</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const handlePin = (latlng) => {
    setPin(latlng);
    set('latitude',  latlng.lat.toFixed(6));
    set('longitude', latlng.lng.toFixed(6));
  };

  const applyNlp = () => {
    if (!nlpHint) return;
    if (nlpHint.severity)    set('severity',     nlpHint.severity);
    if (nlpHint.category)    set('category',     nlpHint.category);
    if (nlpHint.problem_type) set('problem_type', nlpHint.problem_type);
    setNlpHint(null);
  };

  const moveLocationPin = (lat, lon) => {
    handlePin({ lat, lng: lon });
    setLocationHint(null);
  };

  const handleImageChange = async (file) => {
    set('image', file);
    setImageHint(null);
    if (!file) return;

    setImageLoading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { data } = await classifyImage(fd);
      if (data.label && IMAGE_LABEL_TO_PROBLEM_TYPE[data.label]) {
        setImageHint(data);
      }
    } catch {}
    finally { setImageLoading(false); }
  };

  const applyImageHint = () => {
    if (!imageHint) return;
    const mapped = IMAGE_LABEL_TO_PROBLEM_TYPE[imageHint.label];
    if (mapped) {
      set('category', mapped.category);
      set('problem_type', mapped.problem_type);
    }
    setImageHint(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.latitude || !form.longitude) { setError('Please drop a pin on the map to set the location.'); return; }
    if (PHOTO_REQUIRED_TYPES.has(form.problem_type) && !form.image) {
      setError(`A photo is required for "${form.problem_type}" reports so our AI can verify the damage type.`);
      return;
    }
    setError(''); setSubmitting(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (v !== null && v !== '') fd.append(k, v); });
    try {
      await createReport(fd);
      setFeedback('✅ Report submitted successfully. Thank you for helping your community!');
      setForm({ category:'', problem_type:'', description:'', location_name:'', latitude:'', longitude:'', severity:'medium', image:null,
         fuel_station_id: '', government_office_id: '', region: '' });
      setPin(null); setNlpHint(null); setLocationHint(null); setImageHint(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed. Please try again.');
    } finally { setSubmitting(false); }
  };

  const problemTypes = CATEGORIES[form.category] || [];

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">📢</div>
            <div>
              <h1>Report an Issue</h1>
              <p>Drop a pin, describe the problem, and let AI help classify severity.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="panel">
            <form className="report-grid" onSubmit={submit}>

              <div className="field span-6" style={{fontSize:'.85rem',color:'var(--navy-500)'}}>
                Reporting as <b>{user.name || user.email}</b>{user.phone ? ` · ${user.phone}` : ''}
              </div>

              <div className="field span-3">
                <label>Category</label>
                <select required value={form.category}
                  onChange={e=>{ set('category',e.target.value); set('problem_type',''); set('fuel_station_id',''); set('government_office_id',''); }}>
                  <option value="">Select category</option>
                  <option value="electricity">Electricity</option>
                  <option value="fuel">Fuel</option>
                  <option value="roads">Roads</option>
                  <option value="transportation">Transportation</option>
                  <option value="offices">Government Offices</option>
                  <option value="health">Health</option>
                </select>
              </div>
              <div className="field span-3">
                <label>Problem Type</label>
                <select required value={form.problem_type}
                  onChange={e=>set('problem_type',e.target.value)} disabled={!form.category}>
                  <option value="">Select problem type</option>
                  {problemTypes.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="field span-6">
                <label>Which region is this in? <span style={{fontWeight:400,color:'var(--gray-400)'}}>(required — ensures your report reaches the right municipality)</span></label>
                <select required value={form.region} onChange={e=>set('region', e.target.value)}>
                  <option value="">Select your region</option>
                  {jurisdictions.map(j => (
                    <option key={j.id} value={j.jurisdiction}>{j.name}</option>
                  ))}
                </select>
              </div>

              {form.category === 'fuel' && (
                <div className="field span-6">
                  <label>Which station is this about? <span style={{fontWeight:400,color:'var(--gray-400)'}}>(optional — helps group reports about the same station)</span></label>
                  <select value={form.fuel_station_id} onChange={e=>set('fuel_station_id',e.target.value)}>
                    <option value="">Not sure / general area</option>
                    {groupByArea(fuelStations).map(([area, stations]) => (
                      <optgroup key={area} label={area}>
                        {stations.map(s=>(
                          <option key={s.id} value={s.id}>
                            {s.name}{s.brand ? ` (${s.brand})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              {form.category === 'offices' && (
                <div className="field span-6">
                  <label>Which office is this about? <span style={{fontWeight:400,color:'var(--gray-400)'}}>(optional — helps group reports about the same office)</span></label>
                  <select value={form.government_office_id} onChange={e=>set('government_office_id',e.target.value)}>
                    <option value="">Not sure / general area</option>
                    {groupByArea(offices).map(([area, offs]) => (
                      <optgroup key={area} label={area}>
                        {offs.map(o=>(
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              <div className="field span-6">
                <label>
                  Description{' '}
                  {nlpLoading && <span style={{color:'#94a3b8',fontWeight:400}}>— AI analysing…</span>}
                </label>
                <textarea required value={form.description}
                  onChange={e=>set('description',e.target.value)}
                  placeholder="Describe the issue. You can write in Arabic, Arabizi (3arabi), or English."/>
                {nlpHint && (typeof nlpHint.confidence !== 'number' || nlpHint.confidence >= 0.5) && (
                  <div className="nlp-result">
                    <strong>AI severity estimate:</strong>
                    <span>
                      <b style={{textTransform:'capitalize'}}>{nlpHint.severity}</b>
                      {typeof nlpHint.confidence === 'number' && (
                        <span style={{
                          color: nlpHint.confidence < 0.6 ? '#b45309' : '#64748b',
                          fontWeight: nlpHint.confidence < 0.6 ? 700 : 400,
                        }}>
                          {' '}({Math.round(nlpHint.confidence * 100)}% confidence
                          {nlpHint.confidence < 0.6 ? ' — low, please double-check' : ''})
                        </span>
                      )}
                    </span>
                    {nlpHint.category && <span>Category: <b>{nlpHint.category}</b></span>}
                    <button type="button" className="btn btn-sm btn-primary" onClick={applyNlp}>Use this estimate</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setNlpHint(null)}>Dismiss</button>
                  </div>
                )}

                {containsHighStakesKeyword(form.description) && (
                  <div className="nlp-result" style={{ borderColor:'#dc2626', background:'#fef2f2' }}>
                    <strong>⚠️ High-stakes location mentioned</strong>
                    <span>
                      This report mentions a school, hospital, or similar location. Regardless of any AI
                      severity estimate above, please consider marking this <b>High</b> or <b>Critical</b>{' '}
                      and select the severity manually.
                    </span>
                  </div>
                )}

                {locationLoading && (
                  <div style={{color:'#94a3b8',fontSize:'.8rem',marginTop:'.4rem'}}>— Checking location mentioned in text…</div>
                )}

                {locationHint?.type === 'mismatch' && (
                  <div className="nlp-result" style={{borderColor:'#f59e0b'}}>
                    <strong>📍 Location check:</strong>
                    <span>
                      You mentioned <b>{locationHint.mentionedPlace}</b>, which is about{' '}
                      <b>{locationHint.distanceKm}km</b> from your pinned location.
                    </span>
                    <button type="button" className="btn btn-sm btn-primary"
                      onClick={()=>moveLocationPin(locationHint.lat, locationHint.lon)}>
                      Move pin to {locationHint.mentionedPlace}
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setLocationHint(null)}>
                      Keep my pin
                    </button>
                  </div>
                )}
                {locationHint?.type === 'suggestion' && (
                  <div className="nlp-result" style={{borderColor:'#3b82f6'}}>
                    <strong>📍 Location detected:</strong>
                    <span>You mentioned <b>{locationHint.mentionedPlace}</b>. Want to pin it there?</span>
                    <button type="button" className="btn btn-sm btn-primary"
                      onClick={()=>moveLocationPin(locationHint.lat, locationHint.lon)}>
                        Pin {locationHint.mentionedPlace}
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setLocationHint(null)}>
                      Dismiss
                    </button>
                  </div>
                )}
                {locationHint?.type === 'ambiguous' && (
                  <div className="nlp-result" style={{borderColor:'#f59e0b'}}>
                    <strong>📍 Which one did you mean?</strong>
                    <span>
                      <b>{locationHint.mentionedPlace}</b> matches {locationHint.candidates.length} different places in Lebanon.
                    </span>
                    <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
                      {locationHint.candidates.map((c, i) => (
                        <button key={i} type="button" className="btn btn-sm btn-primary"
                          onClick={()=>moveLocationPin(c.lat, c.lon)}>
                          Use {c.place_type || 'this one'} #{i + 1}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setLocationHint(null)}>
                      Keep my pin
                    </button>
                  </div>
                )}
              </div>

              <div className="field span-3">
                <label>Severity</label>
                <select value={form.severity} onChange={e=>set('severity',e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="field span-3">
                <label>Location Name</label>
                <input type="text" required placeholder="e.g. Hamra, Beirut"
                  value={form.location_name} onChange={e=>set('location_name',e.target.value)}/>
              </div>

              <div className="span-6">
                <p style={{fontSize:'.825rem',fontWeight:600,color:'var(--navy-600)',marginBottom:'.5rem'}}>
                  Click the map to drop a pin 📍
                </p>
                <div className="map-picker-wrap">
                  <MapContainer center={[33.888,35.495]} zoom={9} style={{height:'100%',width:'100%'}}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'/>
                    <PinMarker onPin={handlePin}/>
                    {pin && <Marker position={pin}/>}
                  </MapContainer>
                </div>
                {pin && (
                  <div className="coords-display">
                    📍 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                  </div>
                )}
              </div>

              <div className="field span-6">
                <label>
                  Photo{' '}
                  {PHOTO_REQUIRED_TYPES.has(form.problem_type) ? (
                    <span style={{fontWeight:600,color:'#dc2626'}}>
                      (required for "{form.problem_type}" — our AI verifies this damage type automatically)
                    </span>
                  ) : (
                    <span style={{fontWeight:400,color:'var(--gray-400)'}}>(optional — AI will classify road damage automatically)</span>
                  )}
                  {' '}{imageLoading && <span style={{color:'#94a3b8',fontWeight:400}}>— AI analysing photo…</span>}
                </label>
                <input type="file" accept="image/*"
                  required={PHOTO_REQUIRED_TYPES.has(form.problem_type)}
                  onChange={e=>handleImageChange(e.target.files[0])}/>
                {imageHint && (typeof imageHint.confidence !== 'number' || imageHint.confidence >= 0.5) && (
                  <div className="nlp-result">
                    <strong>AI damage estimate:</strong>
                    <span>
                      This looks like a <b>{imageHint.label}</b>{' '}
                      <span style={{
                        color: imageHint.confidence < 0.6 ? '#b45309' : '#64748b',
                        fontWeight: imageHint.confidence < 0.6 ? 700 : 400,
                      }}>
                        ({Math.round(imageHint.confidence * 100)}% confidence
                        {imageHint.confidence < 0.6 ? ' — low, please double-check' : ''})
                      </span>
                    </span>
                    <button type="button" className="btn btn-sm btn-primary" onClick={applyImageHint}>
                      Use this estimate ({IMAGE_LABEL_TO_PROBLEM_TYPE[imageHint.label]?.problem_type})
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setImageHint(null)}>Dismiss</button>
                  </div>
                )}
              </div>

              <div className="span-6" style={{display:'flex',gap:'.75rem',flexWrap:'wrap'}}>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Report'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={()=>{
                  setForm({category:'',problem_type:'',description:'',location_name:'',latitude:'',longitude:'',severity:'medium',image:null, fuel_station_id: '', government_office_id: '', region: ''});
                  setPin(null); setFeedback(''); setError(''); setLocationHint(null); setImageHint(null);
                }}>Clear Form</button>
              </div>
            </form>

            {feedback && <div className="feedback-ok">{feedback}</div>}
            {error    && <div className="feedback-err">{error}</div>}
          </div>
        </div>
      </section>
    </main>
  );
}