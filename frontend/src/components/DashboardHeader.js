import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getNotifications, markNotificationRead } from '../services/api';

const TYPE_LABELS = {
  new_report: '📋 New Report',
  report_update: '📋 Report Update',
};

export default function DashboardHeader() {
  const { user, logoutUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logoutUser();
    navigate('/login');
  };

  const roleLabel = { admin: 'Admin', org_lead: 'Organization Lead', org_staff: 'Staff' }[user?.role] || '';

  // Notification bell — staff-only, since Lead no longer manages reports
  // (per the use-case diagram, Lead's role is create/revoke staff + review
  // the Activity Log). Same underlying notifications table/endpoint and
  // event-driven refresh pattern already built and tested for citizens.
  const [notifications, setNotifications] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const unreadCount = notifications.filter(n => !n.read).length;
  const [search, setSearch] = useState('');
  const visibleNotifications = search.trim()
    ? notifications.filter(n => n.message.toLowerCase().includes(search.trim().toLowerCase()))
    : notifications;

  useEffect(() => {
    if (user?.role !== 'org_staff') return;
    const check = () => getNotifications().then(r => setNotifications(r.data)).catch(() => {});
    check();
    const interval = setInterval(check, 30000);
    window.addEventListener('notifications-updated', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notifications-updated', check);
    };
  }, [user]);

  // Close the dropdown on an outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markRead = async (id) => {
    try {
      await markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      window.dispatchEvent(new Event('notifications-updated'));
    } catch {
      // Fail-soft: stays visible as unread, worst case the person clicks it again.
    }
  };

  return (
    <header className="dashboard-header">
      <div className="dashboard-header-brand">
        <svg width="32" height="32" viewBox="0 0 36 36" fill="none" style={{ borderRadius: 8 }}>
          <rect width="36" height="36" rx="6" fill="#1e40af"/>
          <path d="M18 8L18 12M18 12L16 14L14 14L14 16M18 12L20 14L22 14L22 16M18 12L18 28M14 16L12 18L12 20M22 16L24 18L24 20M12 20L10 22L10 28M24 20L26 22L26 28M10 28L26 28"
            stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="17" y="26" width="2" height="2" fill="#8b4513"/>
        </svg>
        <span className="dashboard-header-text">InfraWatch <span className="dashboard-header-role">— {roleLabel}</span></span>
      </div>
      <div className="dashboard-header-actions">
        {user?.role === 'org_staff' && (
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setDropdownOpen(o => !o)}
              aria-label="Notifications"
              style={{
                position: 'relative', background: 'rgba(255,255,255,.08)', border: 'none',
                borderRadius: '8px', width: '36px', height: '36px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
              }}>
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '-4px', right: '-4px',
                  background: '#ef4444', color: '#fff', borderRadius: '999px',
                  fontSize: '.65rem', fontWeight: 700, minWidth: '16px', height: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px', lineHeight: 1,
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {dropdownOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: '340px',
                maxHeight: '420px', overflowY: 'auto', background: '#fff', borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)', border: '1px solid var(--gray-200)', zIndex: 50,
              }}>
                <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid var(--gray-100)', fontWeight: 700, color: 'var(--navy-800)' }}>
                  Notifications
                </div>
                {notifications.length > 0 && (
                  <div style={{ padding: '.6rem .75rem', borderBottom: '1px solid var(--gray-100)' }}>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="🔍 Search…"
                      style={{ width: '100%', padding: '.4rem .6rem', borderRadius: '6px', border: '1px solid var(--gray-300)', fontSize: '.8rem' }}
                      onClick={e => e.stopPropagation()}/>
                  </div>
                )}
                {notifications.length === 0 ? (
                  <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.85rem' }}>
                    No notifications yet.
                  </div>
                ) : visibleNotifications.length === 0 ? (
                  <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.85rem' }}>
                    No notifications match "{search}".
                  </div>
                ) : (
                  visibleNotifications.map(n => (
                    <div key={n.id}
                      onClick={() => !n.read && markRead(n.id)}
                      style={{
                        padding: '.75rem 1rem', borderBottom: '1px solid var(--gray-100)',
                        background: n.read ? '#fff' : '#f0fdf4', cursor: n.read ? 'default' : 'pointer',
                      }}>
                      <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#64748b', marginBottom: '.2rem' }}>
                        {TYPE_LABELS[n.type] || n.type}
                      </div>
                      <div style={{ fontSize: '.85rem', color: 'var(--navy-800)' }}>{n.message}</div>
                      <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: '.3rem' }}>
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <span className="dashboard-header-user">Hi, <strong>{user?.name}</strong></span>
        <button className="btn btn-sm btn-secondary" onClick={handleLogout}>Logout</button>
      </div>
    </header>
  );
}