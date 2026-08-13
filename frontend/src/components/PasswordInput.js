import React, { useState } from 'react';

// Custom password input, built to replace reliance on browsers' own
// built-in "reveal password" icon (e.g. Edge's native eye toggle), which
// behaves inconsistently — sometimes only working the first time. This
// component owns its own show/hide state entirely in React, so it always
// works the same way regardless of browser, everywhere it's used.
//
// Clipboard blocking (copy/paste/cut) defaults ON, since it matters most
// for "Confirm Password" and "New Password" fields — if someone can just
// paste the same value instead of retyping it, the whole point of a
// confirm field (catching a typo) is defeated. Pass blockClipboard={false}
// for fields where pasting is legitimately needed instead — e.g. signing
// in with a password manager, or pasting a temp password that was just
// copied from TempPasswordModal.
export default function PasswordInput({ value, onChange, placeholder, name, required, minLength, autoComplete, blockClipboard = true, style, ...rest }) {
  const [visible, setVisible] = useState(false);

  const preventClipboard = (e) => e.preventDefault();
  const clipboardHandlers = blockClipboard
    ? { onCopy: preventClipboard, onPaste: preventClipboard, onCut: preventClipboard, onContextMenu: preventClipboard }
    : {};

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        type={visible ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        {...clipboardHandlers}
        style={{ paddingRight: '2.75rem', width: '100%', boxSizing: 'border-box' }}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        style={{
          position: 'absolute', right: '.65rem', top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', padding: '.2rem',
          display: 'flex', alignItems: 'center', color: 'var(--gray-400)',
        }}>
        {visible ? (
          // Eye-off icon
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          // Eye icon
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}