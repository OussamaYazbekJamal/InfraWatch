import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import PasswordRequirements from '../components/PasswordRequirements';
import { isPasswordComplex } from '../utils/passwordRules';
import '../styles/auth.css';

export default function ChangePassword() {
  const { user, loginUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirm,         setConfirm]         = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) { navigate('/login'); return null; }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isPasswordComplex(newPassword)) return setError('Password does not meet the requirements below.');
    if (newPassword !== confirm) return setError('Passwords do not match');

    setLoading(true);
    try {
      const { data } = await changePassword({ currentPassword, newPassword });
      const updatedUser = { ...user, must_change_password: false };
      loginUser(data.token, updatedUser);
      refreshUser({ must_change_password: false });

      if (updatedUser.role === 'admin') {
        navigate('/admin');
      } else if (updatedUser.role === 'org_lead') {
        navigate('/staff');
      } else if (updatedUser.role === 'org_staff') {
        navigate('/staff/fuel-stations');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h2>{user.must_change_password ? 'Set a New Password' : 'Change Password'}</h2>
        {user.must_change_password && (
          <p className="auth-hint">This account was just created — set a permanent password to continue.</p>
        )}
        {error && <div className="auth-error">{error}</div>}

        <div className="stacked-field">
          <label>Current / Temporary Password</label>
          <PasswordInput value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required blockClipboard={false} />
        </div>
        <div className="stacked-field">
          <label>New Password</label>
          <PasswordInput value={newPassword} onChange={e=>setNewPassword(e.target.value)} required />
          <PasswordRequirements password={newPassword} />
        </div>
        <div className="stacked-field">
          <label>Confirm New Password</label>
          <PasswordInput value={confirm} onChange={e=>setConfirm(e.target.value)} required />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Save Password'}
        </button>
      </form>
    </div>
  );
}