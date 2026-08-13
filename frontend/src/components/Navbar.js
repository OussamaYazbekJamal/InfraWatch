import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getNotifications } from '../services/api';
import '../styles/navbar.css';

export default function Navbar() {
  const { user, logoutUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const handleLogout = () => { logoutUser(); navigate('/'); };
  const [unreadCount, setUnreadCount] = useState(0);
  // The mobile menu is a pure CSS checkbox toggle (no JS drives open/close)
  // — clicking a NavLink navigates correctly via React Router, but nothing
  // tells the checkbox to uncheck itself afterward, so the menu stayed
  // visually open until manually toggled again. This ref lets nav link
  // clicks explicitly close it, without needing to rewrite the existing
  // CSS toggle mechanism.
  const menuCheckboxRef = useRef(null);
  const closeMenu = () => { if (menuCheckboxRef.current) menuCheckboxRef.current.checked = false; };

  // Polls unread notification count so the bell badge stays reasonably
  // fresh without needing a full push/websocket setup — reuses the
  // existing GET /notifications endpoint, just counts client-side rather
  // than adding a new dedicated backend endpoint for this alone.
  //
  // Also re-checks on every route change (location.pathname dependency),
  // not just the 30s timer — otherwise marking notifications as read on
  // the Notifications page wouldn't update this badge until whenever the
  // next scheduled poll happened to land, up to 30s of visibly stale count.
  useEffect(() => {
    if (!user || user.role !== 'citizen') return;
    const check = () => {
      getNotifications()
        .then(r => setUnreadCount(r.data.filter(n => !n.read).length))
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 30000);
    // Fired by the Notifications page whenever a notification is marked
    // read — catches the case a route-change listener alone would miss:
    // staying on the same page and reading multiple notifications one
    // after another without navigating anywhere in between.
    window.addEventListener('notifications-updated', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notifications-updated', check);
    };
  }, [user, location.pathname]);

  // SVG fallback logo — shown if no logo image file present
  const LogoMark = () => (
    <svg className="brand-mark" viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="6" fill="#1e40af"/>
      <path d="M18 8L18 12M18 12L16 14L14 14L14 16M18 12L20 14L22 14L22 16M18 12L18 28M14 16L12 18L12 20M22 16L24 18L24 20M12 20L10 22L10 28M24 20L26 22L26 28M10 28L26 28"
        stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="17" y="26" width="2" height="2" fill="#8b4513"/>
    </svg>
  );

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/">
          {/* To use a real logo: place logo.png in public/ and it will show automatically */}
          <LogoMark />
          <span>InfraWatch</span>
        </Link>

        <input ref={menuCheckboxRef} className="nav-toggle" type="checkbox" id="nav-toggle"/>
        <label className="nav-toggle-button" htmlFor="nav-toggle" aria-label="Toggle navigation">
          <span/><span/><span/>
        </label>

        <nav className="nav-menu">
          <NavLink to="/" onClick={closeMenu}>Home</NavLink>
          <NavLink to="/map" onClick={closeMenu}>Map</NavLink>
          <NavLink to="/electricity" onClick={closeMenu}>Electricity</NavLink>
          <NavLink to="/fuel" onClick={closeMenu}>Fuel</NavLink>
          <NavLink to="/roads" onClick={closeMenu}>Roads</NavLink>
          <NavLink to="/health" onClick={closeMenu}>Health</NavLink>
          <NavLink to="/transportation" onClick={closeMenu}>Transport</NavLink>
          <NavLink to="/offices" onClick={closeMenu}>Offices</NavLink>
          <NavLink to="/about" onClick={closeMenu}>About</NavLink>
          <NavLink to="/report" className="report-link" onClick={closeMenu}>Report</NavLink>

          <div className="nav-auth">
            {user ? (
              <>
                {user.role === 'admin' && <NavLink to="/admin" onClick={closeMenu}>Admin</NavLink>}
                {user.role === 'citizen' && (
                  <NavLink to="/notifications" title="Notifications" aria-label="Notifications" onClick={closeMenu}
                    style={{ fontSize: '1.1rem', position: 'relative' }}>
                    🔔
                    {unreadCount > 0 && (
                      <span style={{
                        position: 'absolute', top: '-6px', right: '-8px',
                        background: '#ef4444', color: '#fff', borderRadius: '999px',
                        fontSize: '.65rem', fontWeight: 700, minWidth: '16px', height: '16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 3px', lineHeight: 1,
                      }}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </NavLink>
                )}
                <span className="nav-user">Hi, <strong>{user.name.split(' ')[0]}</strong></span>
                <button className="btn btn-secondary btn-sm" onClick={() => { closeMenu(); handleLogout(); }}>Logout</button>
              </>
            ) : (
              <>
                <Link className="btn btn-secondary btn-sm" to="/login"
                  onClick={() => { closeMenu(); window.dispatchEvent(new Event('reset-login-step')); }}>Login</Link>
                <Link className="btn btn-primary btn-sm" to="/register" style={{color:"white"}} onClick={closeMenu}>Sign up</Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}