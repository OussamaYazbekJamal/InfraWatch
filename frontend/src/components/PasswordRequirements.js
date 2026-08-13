import React from 'react';
import { PASSWORD_RULES } from '../utils/passwordRules';

// Shows a live checklist under a password field as the person types —
// each rule turns green with a checkmark once satisfied. Only rendered
// once the field isn't empty, so it doesn't clutter the form before
// someone's actually started typing.
export default function PasswordRequirements({ password }) {
  if (!password) return null;

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '.5rem 0 0', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      {PASSWORD_RULES.map(rule => {
        const met = rule.test(password);
        return (
          <li key={rule.key} style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.4rem', color: met ? '#059669' : '#94a3b8' }}>
            <span style={{ width: '1rem', textAlign: 'center' }}>{met ? '✓' : '·'}</span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}