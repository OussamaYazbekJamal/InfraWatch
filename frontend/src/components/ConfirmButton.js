import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { confirmReport } from '../services/api';

// Reusable "Confirm this is still happening" button for citizen-facing
// category pages (Fuel, Roads, Electricity, etc.) — same underlying
// confirmReport() call and rules as the Map view's ConfirmBlock:
//   - signed-out visitors see a sign-in prompt instead of a button
//   - the original reporter can't confirm their own report (backend 403)
//   - confirming twice is treated as already-confirmed, not an error
export default function ConfirmButton({ report }) {
  const { user } = useAuth();
  const [count, setCount] = useState(report.confirmation_count ?? 0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) {
    return (
      <div style={{ marginTop: '.65rem', fontSize: '.8rem' }}>
        <Link to="/login" style={{ color: 'var(--green-500)' }}>Sign in</Link> to confirm this is still happening ({count})
      </div>
    );
  }

  if (user.id === report.user_id) {
    return (
      <div style={{ marginTop: '.65rem', fontSize: '.8rem', color: 'var(--gray-400)' }}>
        {count} {count === 1 ? 'person has' : 'people have'} confirmed this
      </div>
    );
  }

  const handleConfirm = async () => {
    if (confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await confirmReport(report.id);
      setCount(data.confirmation_count);
      setConfirmed(true);
    } catch (err) {
      if (err.response?.status === 409) {
        // Already confirmed previously — not an error from the user's
        // point of view, just reflect that state instead of alarming them.
        setConfirmed(true);
      } else {
        setError(err.response?.data?.error || 'Failed to confirm');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: '.65rem' }}>
      <button
        type="button"
        className={`btn btn-sm ${confirmed ? 'btn-secondary' : 'btn-primary'}`}
        disabled={confirmed || busy}
        onClick={handleConfirm}>
        {confirmed ? `✓ Confirmed (${count})` : busy ? 'Confirming…' : `Confirm this is still happening (${count})`}
      </button>
      {error && <div style={{ color: '#dc2626', fontSize: '.75rem', marginTop: '.3rem' }}>{error}</div>}
    </div>
  );
}