import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Usage: <Route path="/admin" element={<RequireRole roles={['admin']}><Admin/></RequireRole>} />
export default function RequireRole({ roles, children }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;

  return children;
}