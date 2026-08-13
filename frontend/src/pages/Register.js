import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register, verifyPhone, resendOtp } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import PasswordRequirements from '../components/PasswordRequirements';
import { isPasswordComplex } from '../utils/passwordRules';
import '../styles/auth.css';

export default function Register() {
  const [form, setForm]       = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const { loginUser, refreshUser } = useAuth();
  const navigate              = useNavigate();

  // 'form' -> the normal registration form
  // 'verify' -> post-registration OTP entry (shown once phone_verified is false)
  const [step, setStep]         = useState('form');
  const [devOtp, setDevOtp]     = useState('');
  const [otpCode, setOtpCode]   = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpBusy, setOtpBusy]   = useState(false);
  const [otpMsg, setOtpMsg]     = useState('');

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!isPasswordComplex(form.password)) { setError('Password does not meet the requirements below.'); return; }
    setError(''); setLoading(true);
    try {
      const { data } = await register(form);
      loginUser(data.token, data.user);
      if (data.user.phone_verified) {
        navigate('/');
      } else {
        // Demo/no-SMS-provider mode: the code is returned directly in the
        // response so it can be shown on-screen instead of sent via a real
        // SMS carrier. Swap this for an actual "check your phone" message
        // once a real provider is wired in server-side.
        setDevOtp(data.dev_otp_code || '');
        setStep('verify');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally { setLoading(false); }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setOtpError(''); setOtpBusy(true);
    try {
      await verifyPhone(otpCode.trim());
      refreshUser({ phone_verified: true });
      navigate('/');
    } catch (err) {
      setOtpError(err.response?.data?.error || 'Verification failed. Please try again.');
    } finally { setOtpBusy(false); }
  };

  const resend = async () => {
    setOtpError(''); setOtpMsg(''); setOtpBusy(true);
    try {
      const { data } = await resendOtp();
      setDevOtp(data.dev_otp_code || '');
      setOtpMsg('A new code has been issued.');
    } catch (err) {
      setOtpError(err.response?.data?.error || 'Could not resend code.');
    } finally { setOtpBusy(false); }
  };

  if (step === 'verify') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ borderRadius: 8 }}>
              <rect width="36" height="36" rx="6" fill="#1e40af"/>
              <path d="M18 8L18 12M18 12L16 14L14 14L14 16M18 12L20 14L22 14L22 16M18 12L18 28M14 16L12 18L12 20M22 16L24 18L24 20M12 20L10 22L10 28M24 20L26 22L26 28M10 28L26 28"
                stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="17" y="26" width="2" height="2" fill="#8b4513"/>
            </svg>
            <span className="auth-logo-text">InfraWatch</span>
          </div>

          <h1>Verify your phone</h1>
          <p className="sub">Enter the 6-digit code to confirm your number. This helps keep confirmations and reports trustworthy.</p>

          {devOtp && (
            <div className="feedback-ok" style={{ marginBottom: '1rem' }}>
              Demo mode — no SMS provider connected yet. Your code is: <b>{devOtp}</b>
            </div>
          )}

          <form className="auth-form" onSubmit={submitOtp}>
            <div className="field">
              <label>Verification Code</label>
              <input type="text" inputMode="numeric" maxLength={6} required autoComplete="one-time-code"
                value={otpCode} onChange={e=>setOtpCode(e.target.value)} placeholder="123456"/>
            </div>
            {otpError && <div className="feedback-err">{otpError}</div>}
            {otpMsg   && <div className="feedback-ok">{otpMsg}</div>}
            <button className="btn btn-primary" type="submit" disabled={otpBusy}>
              {otpBusy ? 'Verifying…' : 'Verify'}
            </button>
          </form>

          <p className="auth-switch">
            Didn't get a code?{' '}
            <button type="button" className="btn-link" onClick={resend} disabled={otpBusy}
              style={{ background:'none', border:'none', color:'var(--navy-600)', textDecoration:'underline', cursor:'pointer', padding:0, font:'inherit' }}>
              Resend code
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ borderRadius: 8 }}>
            <rect width="36" height="36" rx="6" fill="#1e40af"/>
            <path d="M18 8L18 12M18 12L16 14L14 14L14 16M18 12L20 14L22 14L22 16M18 12L18 28M14 16L12 18L12 20M22 16L24 18L24 20M12 20L10 22L10 28M24 20L26 22L26 28M10 28L26 28"
              stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="17" y="26" width="2" height="2" fill="#8b4513"/>
          </svg>
          <span className="auth-logo-text">InfraWatch</span>
        </div>

        <h1>Create your account</h1>
        <p className="sub">Join InfraWatch to report infrastructure issues and help your community.</p>

        <form className="auth-form" onSubmit={submit}>
          <div className="field">
            <label>Full Name</label>
            <input type="text" name="name" required autoComplete="name"
              value={form.name} onChange={handle} placeholder="Ahmad Khalil"/>
          </div>
          <div className="field">
            <label>Email address</label>
            <input type="email" name="email" required autoComplete="email"
              value={form.email} onChange={handle} placeholder="you@example.com"/>
          </div>
          <div className="field">
            <label>Phone Number</label>
            <input type="tel" name="phone" required autoComplete="tel"
              value={form.phone} onChange={handle} placeholder="+961 XX XXX XXX"/>
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput name="password" required minLength={8} autoComplete="new-password"
              value={form.password} onChange={handle} placeholder="••••••••"/>
            <PasswordRequirements password={form.password} />
          </div>
          {error && <div className="feedback-err">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}