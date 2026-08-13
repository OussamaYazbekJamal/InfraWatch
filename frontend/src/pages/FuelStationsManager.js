import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/AuthContext';
import {
  getMyFuelStations, createFuelStation, updateStation, deleteFuelStation,
  getMyOffices, createOffice, updateOffice, deleteOffice,
  getMyRoutes, createRoute, updateRoute, deleteRoute,
  getMyOutageRecords, createOutageRecord, updateOutageRecord, deleteOutageRecord,
  getMyHealthFacilities, createHealthFacility, updateHealthFacility, deleteHealthFacility,
  getMyReports, updateStatus, downloadPdfReport,
} from '../services/api';
import '../styles/admin.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ── Per-entity configuration — one shared list/add/edit/delete UI driven
// by this config, instead of five near-duplicate components. Field keys
// must match exactly what each backend route expects in req.body.
const ENTITY_CONFIGS = {
  fuel: {
    label: 'Fuel Stations',
    icon: '⛽',
    api: { getMy: getMyFuelStations, create: createFuelStation, update: updateStation, remove: deleteFuelStation },
    hasMap: true,
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'area', label: 'Area' },
      { key: 'status', label: 'Status', type: 'select', options: ['available', 'limited', 'closed'] },
      { key: 'diesel_price', label: 'Diesel Price', type: 'number' },
      { key: 'gasoline_price', label: 'Gasoline Price', type: 'number' },
      { key: 'brand', label: 'Brand' },
      { key: 'landmark_note', label: 'Landmark Note' },
    ],
  },
  offices: {
    label: 'Government Offices',
    icon: '🏛️',
    api: { getMy: getMyOffices, create: createOffice, update: updateOffice, remove: deleteOffice },
    hasMap: true,
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'office_type', label: 'Office Type', required: true },
      { key: 'area', label: 'Area' },
      { key: 'status', label: 'Status', type: 'select', options: ['open', 'closed', 'limited'] },
      { key: 'landmark_note', label: 'Landmark Note' },
    ],
  },
  transport: {
    label: 'Transport Routes',
    icon: '🚌',
    api: { getMy: getMyRoutes, create: createRoute, update: updateRoute, remove: deleteRoute },
    hasMap: false,
    fields: [
      { key: 'route_number', label: 'Route Number', required: true },
      { key: 'origin', label: 'Origin', required: true },
      { key: 'destination', label: 'Destination', required: true },
      { key: 'stops', label: 'Stops' },
      { key: 'duration', label: 'Duration' },
      { key: 'frequency', label: 'Frequency' },
      { key: 'price_range', label: 'Price Range' },
      { key: 'distance_km', label: 'Distance (km)', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'suspended'] },
    ],
  },
  outage: {
    label: 'Outage Data',
    icon: '⚡',
    api: { getMy: getMyOutageRecords, create: createOutageRecord, update: updateOutageRecord, remove: deleteOutageRecord },
    hasMap: false,
    fields: [
      { key: 'district', label: 'District', required: true },
      { key: 'month_name', label: 'Month Name' },
      { key: 'month_num', label: 'Month # (1-12)', type: 'number', required: true },
      { key: 'year', label: 'Year', type: 'number', required: true },
      { key: 'avg_hours', label: 'Avg Outage Hours', type: 'number' },
    ],
  },
  health: {
    label: 'Health Facilities',
    icon: '🏥',
    api: { getMy: getMyHealthFacilities, create: createHealthFacility, update: updateHealthFacility, remove: deleteHealthFacility },
    hasMap: true,
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'facility_type', label: 'Facility Type', required: true },
      { key: 'area', label: 'Area' },
      { key: 'status', label: 'Status', type: 'select', options: ['open', 'closed', 'limited'] },
      { key: 'landmark_note', label: 'Landmark Note' },
    ],
  },
};

const TAB_ORDER = ['reports', 'fuel', 'offices', 'transport', 'outage', 'health'];

function ClickCatcher({ onPick }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

// Moves the map to a searched location without placing a pin — the person
// still clicks to drop the actual pin, this just gets them to the right
// neighborhood first instead of hunting around by scrolling/zooming.
function MapRecenter({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView([target.lat, target.lng], 15);
  }, [target, map]);
  return null;
}

// Free geocoding via OSM's Nominatim — no API key, no billing account,
// unlike Google's Places/Geocoding APIs. Deliberately NOT a <form> — this
// renders inside the outer Add/Edit form, and nested <form> elements are
// invalid HTML; the browser was letting the click fall through to the
// outer form's native submit, reloading the whole page instead of running
// our handler.
function AddressSearch({ onFound }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true); setErr('');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.length) {
        onFound(parseFloat(data[0].lat), parseFloat(data[0].lon));
      } else {
        setErr('Not found — try a different search.');
      }
    } catch {
      setErr('Search failed — try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="text" placeholder="Search an area or street name…" value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
        style={{ flex: '1 1 200px', minWidth: 0, padding: '.4rem .6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '.85rem' }}/>
      <button type="button" className="btn btn-sm btn-secondary" onClick={search} disabled={searching}>
        {searching ? 'Searching…' : 'Search'}
      </button>
      {err && <span style={{ fontSize: '.75rem', color: '#dc2626' }}>{err}</span>}
    </div>
  );
}

const TILE_STYLES = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
  },
};

// Esri's satellite imagery has no place names baked in — this free overlay
// (roads/borders/town labels) renders on top of it, same trick real
// satellite map views use (label layer over imagery layer).
const LABELS_OVERLAY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

// Click-to-drop-a-pin picker: satellite/street toggle, address search to
// jump to a neighborhood, and gray reference markers for the org's other
// existing rows of the same type so the map isn't just blank streets.
function LocationPicker({ latitude, longitude, onPick, referenceRows = [] }) {
  const [style, setStyle] = useState('satellite');
  const [recenterTo, setRecenterTo] = useState(null);
  const lat = latitude ? parseFloat(latitude) : null;
  const lng = longitude ? parseFloat(longitude) : null;
  const center = lat && lng ? [lat, lng] : [33.888, 35.495];
  const tile = TILE_STYLES[style];

  return (
    <div style={{ marginBottom: '.75rem' }}>
      <AddressSearch onFound={(foundLat, foundLng) => setRecenterTo({ lat: foundLat, lng: foundLng })}/>

      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.5rem' }}>
        <button type="button" className={`btn btn-sm ${style === 'street' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStyle('street')}>Street</button>
        <button type="button" className={`btn btn-sm ${style === 'satellite' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStyle('satellite')}>Satellite</button>
      </div>

      <div style={{ height: 260, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <MapContainer center={center} zoom={lat ? 15 : 9} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={tile.url} attribution={tile.attribution}/>
          {style === 'satellite' && <TileLayer url={LABELS_OVERLAY_URL}/>}
          <ClickCatcher onPick={onPick}/>
          <MapRecenter target={recenterTo}/>
          {referenceRows.map(row => (
            row.latitude && row.longitude && (
              <CircleMarker key={row.id} center={[parseFloat(row.latitude), parseFloat(row.longitude)]}
                radius={5} pathOptions={{ fillColor: '#94a3b8', color: '#64748b', weight: 1, fillOpacity: 0.6 }}/>
            )
          ))}
          {lat && lng && <Marker position={[lat, lng]}/>}
        </MapContainer>
      </div>
      {lat && lng && (
        <div style={{ fontSize: '.78rem', color: '#64748b', marginTop: '.3rem' }}>
          📍 {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
      )}
    </div>
  );
}

function blankForm(config) {
  const f = {};
  config.fields.forEach(field => { f[field.key] = ''; });
  if (config.hasMap) { f.latitude = ''; f.longitude = ''; }
  return f;
}

function FieldInput({ field, value, onChange }) {
  if (field.type === 'select') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input type={field.type === 'number' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : undefined}
      required={field.required} value={value} onChange={e => onChange(e.target.value)}/>
  );
}

// One shared list/add/edit/delete panel, configured per entity via ENTITY_CONFIGS.
function EntityPanel({ entityKey }) {
  const config = ENTITY_CONFIGS[entityKey];
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(blankForm(config));
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blankForm(config));
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  // Search box — lets staff quickly check "does this already exist?"
  // before adding a new row, since all staff in an org share the same
  // data (one person's addition is immediately visible to everyone else).
  // Searches across every field defined for this entity, not just one
  // fixed "name" field, since different entities key on different fields
  // (transport has no single name field, for example — origin/destination
  // matter more there).
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await config.api.getMy();
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.error || `Failed to load ${config.label.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    setShowAddForm(false);
    setEditingId(null);
    setError('');
    setFeedback('');
    setSearch('');
    load();
  }, [entityKey]);

  const submitAdd = async (e) => {
    e.preventDefault();
    setError(''); setFeedback(''); setAdding(true);
    try {
      await config.api.create(addForm);
      setFeedback(`✅ ${config.label.slice(0, -1)} added.`);
      setAddForm(blankForm(config));
      setShowAddForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to add ${config.label.toLowerCase()}`);
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    const f = {};
    config.fields.forEach(field => { f[field.key] = row[field.key] ?? ''; });
    if (config.hasMap) { f.latitude = row.latitude ?? ''; f.longitude = row.longitude ?? ''; }
    setEditForm(f);
  };

  const submitEdit = async (e, id) => {
    e.preventDefault();
    setError(''); setFeedback(''); setSavingId(id);
    try {
      await config.api.update(id, editForm);
      setFeedback(`✅ ${config.label.slice(0, -1)} updated.`);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to update ${config.label.toLowerCase()}`);
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(`Delete this ${config.label.slice(0, -1).toLowerCase()}? This cannot be undone.`)) return;
    setError(''); setFeedback(''); setDeletingId(id);
    try {
      await config.api.remove(id);
      setFeedback(`✅ ${config.label.slice(0, -1)} deleted.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to delete ${config.label.toLowerCase()}`);
    } finally {
      setDeletingId(null);
    }
  };

  const renderFormFields = (form, setForm, excludeId = null) => (
    <>
      {config.fields.map(field => (
        <div className="field" key={field.key} style={{ minWidth: 160 }}>
          <label>{field.label}</label>
          <FieldInput field={field} value={form[field.key]}
            onChange={v => setForm(f => ({ ...f, [field.key]: v }))}/>
        </div>
      ))}
      {config.hasMap && (
        <div style={{ flexBasis: '100%' }}>
          <label style={{ display: 'block', marginBottom: '.35rem', fontWeight: 600, fontSize: '.85rem' }}>
            Search, then click the map to set the location
          </label>
          <LocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            referenceRows={rows.filter(r => r.id !== excludeId)}
            onPick={(lat, lng) => setForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))}
          />
        </div>
      )}
    </>
  );

  const filteredRows = search.trim()
    ? rows.filter(row =>
        config.fields.some(field => String(row[field.key] ?? '').toLowerCase().includes(search.trim().toLowerCase()))
      )
    : rows;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2>{config.icon} {config.label}</h2>
        <button className="btn btn-primary" type="button" onClick={() => setShowAddForm(s => !s)}>
          {showAddForm ? 'Cancel' : `+ Add ${config.label.slice(0, -1)}`}
        </button>
      </div>

      {feedback && <div className="feedback-ok" style={{ marginBottom: '1rem' }}>{feedback}</div>}
      {error && <div className="feedback-err" style={{ marginBottom: '1rem' }}>{error}</div>}

      {showAddForm && (
        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <form onSubmit={submitAdd} style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {renderFormFields(addForm, setAddForm)}
            <div style={{ flexBasis: '100%' }}>
              <button className="btn btn-primary" type="submit" disabled={adding}>
                {adding ? 'Adding…' : `Add ${config.label.slice(0, -1)}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`🔍 Search existing ${config.label.toLowerCase()} before adding a new one…`}
            style={{
              maxWidth: '420px', width: '100%', padding: '.65rem .9rem',
              borderRadius: 'var(--radius-md)', border: '1.5px solid var(--gray-300)',
              fontSize: '.9rem', fontFamily: 'var(--font-sans)', color: 'var(--navy-800)',
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--green-500)'; e.target.style.boxShadow = '0 0 0 3px rgba(16,185,129,.15)'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--gray-300)'; e.target.style.boxShadow = 'none'; }}
          />
          {search.trim() && (
            <span style={{ marginLeft: '.75rem', fontSize: '.8rem', color: '#64748b' }}>
              {filteredRows.length} match{filteredRows.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="spinner-wrap"><div className="spinner"/></div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No {config.label.toLowerCase()} to manage yet.</div>
      ) : filteredRows.length === 0 ? (
        <div className="empty-state">No {config.label.toLowerCase()} match "{search}".</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredRows.map(row => (
            <div key={row.id} className="panel">
              {editingId === row.id ? (
                <form onSubmit={e => submitEdit(e, row.id)} style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {renderFormFields(editForm, setEditForm, row.id)}
                  <div style={{ flexBasis: '100%', display: 'flex', gap: '.75rem' }}>
                    <button className="btn btn-primary" type="submit" disabled={savingId === row.id}>
                      {savingId === row.id ? 'Saving…' : (row.is_own ? 'Save' : 'Save & Claim')}
                    </button>
                    <button className="btn btn-secondary" type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {row.name || row.route_number || row.district}{' '}
                      {row.is_own ? (
                        <span className="pill pill-available">Your org</span>
                      ) : (
                        <span className="pill pill-limited">Unclaimed</span>
                      )}
                    </div>
                    <div style={{ fontSize: '.85rem', color: '#64748b' }}>
                      {config.fields
                        .filter(f => f.key !== 'name' && row[f.key])
                        .slice(0, 3)
                        .map(f => `${f.label}: ${row[f.key]}`)
                        .join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem' }}>
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => startEdit(row)}>
                      {row.is_own ? 'Edit' : 'Claim & Edit'}
                    </button>
                    {row.is_own && (
                      <button className="btn btn-sm btn-danger" type="button"
                        onClick={() => remove(row.id)} disabled={deletingId === row.id}>
                        {deletingId === row.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_OPTIONS = ['pending', 'reviewed', 'resolved'];
const SEV_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#1a1a2e' };

// Reports come from citizens, not staff — this panel is view + triage
// (status updates) only, not create/edit/delete like the other 5 tabs.
// Scoped to the staff's own jurisdiction server-side (GET /reports/manage).
const REPORT_FILTERS = ['all', 'pending', 'reviewed', 'resolved'];
const SEVERITY_FILTERS = ['all', 'low', 'medium', 'high', 'critical'];

function ReportsPanel() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [reportSearch, setReportSearch] = useState('');
  const [expandedClusters, setExpandedClusters] = useState({});
  // Per-row draft state, keyed by report id — lets each row's dropdown/note
  // be edited independently before "Send Update" is clicked. Only committed
  // to the server (and only then possibly notifies reporter + confirmers)
  // when Send Update is pressed, not on every keystroke/selection.
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getMyReports();
      setReports(data);
      setDrafts(Object.fromEntries(data.map(r => [r.id, { status: r.status, note: '' }])));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setDraftStatus = (id, status) => setDrafts(p => ({ ...p, [id]: { ...p[id], status } }));
  const setDraftNote   = (id, note)   => setDrafts(p => ({ ...p, [id]: { ...p[id], note } }));

  const sendUpdate = async (id) => {
    const draft = drafts[id];
    if (!draft) return;
    setUpdatingId(id);
    try {
      await updateStatus(id, draft.status, draft.note);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status: draft.status } : r));
      setDrafts(p => ({ ...p, [id]: { status: draft.status, note: '' } }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const [pdfLoading, setPdfLoading] = useState(false);
  const downloadReport = async () => {
    setPdfLoading(true);
    setError('');
    try {
      const res = await downloadPdfReport();
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'InfraWatch_Report.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to generate PDF report');
    } finally {
      setPdfLoading(false);
    }
  };

  const visibleReports = reports
    .filter(r => filter === 'all' || r.status === filter)
    .filter(r => severityFilter === 'all' || r.severity === severityFilter)
    .filter(r => {
      if (!reportSearch.trim()) return true;
      const q = reportSearch.trim().toLowerCase();
      return (r.location_name || '').toLowerCase().includes(q)
        || (r.category || '').toLowerCase().includes(q)
        || (r.problem_type || '').toLowerCase().includes(q)
        || (r.name || '').toLowerCase().includes(q);
    });

  // Groups all fetched reports by cluster_id, so clicking a duplicate badge
  // can show the OTHER report(s) in that same cluster directly, rather than
  // just a generic count with nothing to compare against.
  const reportsByCluster = {};
  reports.forEach(r => {
    if (r.cluster_id) {
      (reportsByCluster[r.cluster_id] = reportsByCluster[r.cluster_id] || []).push(r);
    }
  });
  const counts = {
    all: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    reviewed: reports.filter(r => r.status === 'reviewed').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
  };
  const severityCounts = {
    all: reports.length,
    low: reports.filter(r => r.severity === 'low').length,
    medium: reports.filter(r => r.severity === 'medium').length,
    high: reports.filter(r => r.severity === 'high').length,
    critical: reports.filter(r => r.severity === 'critical').length,
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0 }}>📋 Reports in Your Jurisdiction</h2>
        <button className="btn btn-sm btn-primary" type="button" onClick={downloadReport} disabled={pdfLoading}>
          {pdfLoading ? 'Generating…' : '📄 Export PDF Report'}
        </button>
      </div>
      {error && <div className="feedback-err" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
        {REPORT_FILTERS.map(f => (
          <button key={f} type="button"
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.8rem', color: '#64748b', fontWeight: 600 }}>Priority:</span>
        {SEVERITY_FILTERS.map(s => (
          <button key={s} type="button"
            className={`btn btn-sm ${severityFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSeverityFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)} ({severityCounts[s]})
          </button>
        ))}
      </div>

      <input type="text" value={reportSearch} onChange={e => setReportSearch(e.target.value)}
        placeholder="🔍 Search by location, category, type, or reporter…"
        style={{ maxWidth: '400px', width: '100%', padding: '.6rem .85rem', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--gray-300)', fontSize: '.85rem', marginBottom: '1rem' }}/>

      {loading ? (
        <div className="spinner-wrap"><div className="spinner"/></div>
      ) : reports.length === 0 ? (
        <div className="empty-state">No reports in your jurisdiction yet.</div>
      ) : visibleReports.length === 0 ? (
        <div className="empty-state">
          No reports match{filter !== 'all' ? ` status "${filter}"` : ''}{filter !== 'all' && severityFilter !== 'all' ? ' and' : ''}{severityFilter !== 'all' ? ` priority "${severityFilter}"` : ''}{filter === 'all' && severityFilter === 'all' ? ' this filter' : ''}.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{width:'16%'}}>Location</th>
                <th style={{width:'8%'}}>Category</th>
                <th style={{width:'9%'}}>Type</th>
                <th style={{width:'8%'}}>Severity</th>
                <th style={{width:'10%'}}>District</th>
                <th style={{width:'10%'}}>Reporter</th>
                <th style={{width:'7%'}}>Confirmations</th>
                <th style={{width:'32%'}}>Status &amp; Note</th>
              </tr>
            </thead>
            <tbody>
              {visibleReports.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>
                    {r.location_name}
                    {r.cluster_id && (
                      <div style={{ marginTop: '.25rem' }}>
                        <span className="pill" style={{ background: '#fef3c7', color: '#92400e', fontSize: '.68rem', cursor: 'pointer' }}
                          onClick={() => setExpandedClusters(p => ({ ...p, [r.id]: !p[r.id] }))}>
                          ⚠ Possible duplicate — {r.cluster_report_count} "{r.cluster_type}" reports nearby {expandedClusters[r.id] ? '▲' : '▼'}
                        </span>
                        {expandedClusters[r.id] && (
                          <div style={{ marginTop: '.4rem', padding: '.5rem .6rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '.75rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '.3rem', color: '#92400e' }}>Other report(s) in this cluster:</div>
                            {(reportsByCluster[r.cluster_id] || []).filter(other => other.id !== r.id).map(other => (
                              <div key={other.id} style={{ marginBottom: '.4rem', paddingBottom: '.4rem', borderBottom: '1px solid #fde68a' }}>
                                <div><strong>{other.location_name}</strong> — {other.description}</div>
                                <div style={{ color: '#a16207', marginTop: '.15rem' }}>
                                  By {other.name || 'Anonymous'} · {new Date(other.created_at).toLocaleDateString()} · status: {other.status}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{r.category}</td>
                  <td>{r.problem_type}</td>
                  <td>
                    <span className="pill" style={{ background: `${SEV_COLORS[r.severity] || '#94a3b8'}22`, fontSize:10,color: SEV_COLORS[r.severity] || '#64748b' }}>
                      {r.severity}
                    </span>
                  </td>
                  <td>{r.district || '—'}</td>
                  <td>
                    {r.name || '—'}
                    {r.phone && <div style={{ fontSize: '.75rem', color: '#64748b' }}>{r.phone}</div>}
                  </td>
                  <td>{r.confirmation_count ?? 0}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                      <select className="btn btn-sm btn-secondary" value={drafts[r.id]?.status ?? r.status}
                        disabled={updatingId === r.id}
                        onChange={e => setDraftStatus(r.id, e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box' }}>
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input type="text" placeholder="Note to reporter (optional)…"
                        value={drafts[r.id]?.note ?? ''}
                        disabled={updatingId === r.id}
                        onChange={e => setDraftNote(r.id, e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '.3rem .5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '.8rem' }}/>
                      <button className="btn btn-sm btn-primary" type="button"
                        disabled={updatingId === r.id} onClick={() => sendUpdate(r.id)}
                        style={{ width: '100%' }}>
                        {updatingId === r.id ? 'Sending…' : 'Send Update'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FuelStationsManager() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('reports');

  if (!user || !['org_staff', 'org_lead'].includes(user.role)) {
    return (
      <div className="admin-layout">
        <div className="admin-content">
          <div className="panel">
            <h3>Org Staff access required</h3>
            <p>This page is only available to logged-in Org Staff or Org Lead accounts.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h3>Organization</h3>
        {TAB_ORDER.map(key => (
          <button key={key}
            className={`sidebar-link ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}>
            {key === 'reports' ? '📋 Reports' : `${ENTITY_CONFIGS[key].icon} ${ENTITY_CONFIGS[key].label}`}
          </button>
        ))}
        {user.role === 'org_lead' && (
          <Link to="/staff" className="sidebar-link" style={{ display: 'block', textDecoration: 'none' }}>
            👥 Staff Management
          </Link>
        )}
      </aside>

      <div className="admin-content">
        <div className="panel">
          {activeTab === 'reports' ? <ReportsPanel/> : <EntityPanel entityKey={activeTab}/>}
        </div>
      </div>
    </div>
  );
}