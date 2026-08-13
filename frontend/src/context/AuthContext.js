import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('iw_user');
      if (stored) setUser(JSON.parse(stored));
    } catch {}
    setLoading(false);
  }, []);

  const loginUser  = (token, userData) => {
    localStorage.setItem('iw_token', token);
    localStorage.setItem('iw_user',  JSON.stringify(userData));
    setUser(userData);
  };
  const logoutUser = () => {
    localStorage.removeItem('iw_token');
    localStorage.removeItem('iw_user');
    setUser(null);
  };

  // Called after a successful change-password to refresh the stored user
  // (specifically must_change_password: false) without a full re-login.
  const refreshUser = (patch) => {
    setUser((prev) => {
      const updated = { ...prev, ...patch };
      localStorage.setItem('iw_user', JSON.stringify(updated));
      return updated;
    });
  };

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, loading, loginUser, logoutUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);