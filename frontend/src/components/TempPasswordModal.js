import React from 'react';
import '../styles/admin.css'

export default function TempPasswordModal({ email, tempPassword, onClose }) {
  const copy = () => navigator.clipboard.writeText(tempPassword);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Account Created</h3>
        <p>Share these credentials with <strong>{email}</strong>. This password is shown <strong>only once</strong>.</p>
        <div className="temp-password-box">
          <code>{tempPassword}</code>
          <button className="btn btn-sm btn-secondary" onClick={copy}>Copy</button>
        </div>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}