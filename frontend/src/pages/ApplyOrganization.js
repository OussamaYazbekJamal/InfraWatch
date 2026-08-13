import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { applyOrganization, previewJurisdiction } from '../services/api';
import '../styles/auth.css';

function PinMarker({ onPin }) {
  useMapEvents({ click(e) { onPin(e.latlng); } });
  return null;
}

export default function ApplyOrganization() {
  const [form, setForm] = useState({ name: '', type: 'municipality', jurisdiction_detail: '', contact_name: '', contact_email: '', contact_phone: '' });
  const [pin, setPin] = useState(null);
  const [detectedJurisdiction, setDetectedJurisdiction] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // Reverse-geocodes the pinned point live, the moment it's dropped — so
  // the applicant sees exactly what jurisdiction will be used before they
  // submit, rather than finding out only after. Uses the same
  // resolveDistrict() logic (via the backend) that citizen reports use,
  // guaranteeing this preview matches what report matching will use later.
  const handlePin = async (latlng) => {
    setPin(latlng);
    setDetectedJurisdiction('');
    setDetectError('');
    setDetecting(true);
    try {
      const { data } = await previewJurisdiction(latlng.lat, latlng.lng);
      if (data.district) {
        setDetectedJurisdiction(data.district);
      } else {
        setDetectError('Could not determine a jurisdiction for this exact point — try clicking a more central location, like near your municipal office.');
      }
    } catch {
      setDetectError('Could not check this location right now — you can still submit, but please try clicking again if this persists.');
    } finally {
      setDetecting(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!pin) { setError('Please click the map to pin your jurisdiction\'s location.'); return; }

    const phoneDigits = form.contact_phone.replace(/[\s\-]/g, '');
    if (!/^\+?\d{7,15}$/.test(phoneDigits)) {
      setError('Please enter a valid phone number (digits only, optional + country code).');
      return;
    }

    setLoading(true);
    try {
      const result = await applyOrganization({ ...form, latitude: pin.lat, longitude: pin.lng });
      setDetectedJurisdiction(result.data.jurisdiction);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit application');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h2>Application Submitted</h2>
          <p>Thanks — your organization's application is pending review, covering the <strong>{detectedJurisdiction}</strong>{form.jurisdiction_detail ? ` (${form.jurisdiction_detail})` : ''} jurisdiction. We'll reach out to the contact email once it's approved.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} style={{ maxWidth: '560px' }}>
        <h2>Apply as an Organization</h2>
        <p className="auth-hint">Municipalities, government offices, and NGOs can request an account to manage reports in their jurisdiction.</p>
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '.85rem 1.1rem', borderRadius: '10px', fontSize: '.875rem', fontWeight: 500, marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div className="stacked-field">
          <label>Organization Name</label>
          <input value={form.name} onChange={update('name')} required />
        </div>

        <div className="stacked-field">
          <label>Type</label>
          <select value={form.type} onChange={update('type')}>
            <option value="municipality">Municipality</option>
            <option value="government">Government</option>
            <option value="ngo">NGO</option>
          </select>
        </div>

        <div className="stacked-field">
          <label>Jurisdiction</label>
          <p style={{ fontSize: '.82rem', color: 'var(--gray-400)', marginBottom: '.5rem' }}>
            Click the map to pin your jurisdiction's location — e.g. your municipal office or town center. The jurisdiction name is detected automatically from this point, so it matches how citizen reports are located.
          </p>
          <div style={{ height: '260px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1.5px solid var(--gray-300)' }}>
            <MapContainer center={[33.888, 35.495]} zoom={9} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'/>
              <PinMarker onPin={handlePin}/>
              {pin && <Marker position={pin}/>}
            </MapContainer>
          </div>

          {pin && (
            <div style={{ marginTop: '.6rem', fontSize: '.85rem' }}>
              📍 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              {detecting && <div style={{ color: 'var(--gray-400)', marginTop: '.3rem' }}>Detecting jurisdiction…</div>}
              {!detecting && detectedJurisdiction && (
                <div style={{ color: '#059669', fontWeight: 600, marginTop: '.3rem' }}>✓ Detected jurisdiction: {detectedJurisdiction}</div>
              )}
              {!detecting && detectedJurisdiction && (
                <div style={{ marginTop: '.75rem' }}>
                  <label style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--navy-600)' }}>
                    Additional detail <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(optional — e.g. a specific neighborhood not shown separately on the map)</span>
                  </label>
                  <input value={form.jurisdiction_detail} onChange={update('jurisdiction_detail')}
                    placeholder="e.g. Downtown District" style={{ marginTop: '.35rem' }}/>
                </div>
              )}
              {!detecting && detectError && (
                <div style={{ color: '#dc2626', marginTop: '.3rem' }}>{detectError}</div>
              )}
            </div>
          )}
        </div>

        <div className="stacked-field">
          <label>Contact Name</label>
          <input value={form.contact_name} onChange={update('contact_name')} required />
        </div>

        <div className="stacked-field">
          <label>Contact Email</label>
          <input type="email" value={form.contact_email} onChange={update('contact_email')} required />
        </div>

        <div className="stacked-field">
          <label>Contact Phone</label>
          <input type="tel" value={form.contact_phone} onChange={update('contact_phone')} placeholder="+961 XX XXX XXX" required />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading || !pin}>
          {loading ? 'Submitting...' : 'Submit Application'}
        </button>
      </form>
    </div>
  );
}