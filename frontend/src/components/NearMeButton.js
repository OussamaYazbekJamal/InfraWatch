import React from 'react';

// Reusable "Show near me" toggle button + state display, used identically
// across every category page. Kept as its own small component so the
// button/feedback markup isn't duplicated six times.
export default function NearMeButton({ myDistrict, detecting, error, onRequest, onClear }) {
  if (myDistrict) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span className="pill" style={{ background: '#eff6ff', color: '#1e40af' }}>
          📍 Showing results near: {myDistrict}
        </span>
        <button className="btn btn-sm btn-secondary" type="button" onClick={onClear}>Show all instead</button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button className="btn btn-sm btn-secondary" type="button" onClick={onRequest} disabled={detecting}>
        {detecting ? '🔍 Detecting your location…' : '📍 Show near me'}
      </button>
      {error && <div style={{ fontSize: '.8rem', color: '#dc2626', marginTop: '.4rem' }}>{error}</div>}
    </div>
  );
}