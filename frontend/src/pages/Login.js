import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, forgotPassword, resetPassword } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import PasswordRequirements from '../components/PasswordRequirements';
import { isPasswordComplex } from '../utils/passwordRules';
import '../styles/auth.css';

const Logo = () => (
  <div className="auth-logo">
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ borderRadius: 8 }}>
      <rect width="36" height="36" rx="6" fill="#1e40af"/>
      <path d="M18 8L18 12M18 12L16 14L14 14L14 16M18 12L20 14L22 14L22 16M18 12L18 28M14 16L12 18L12 20M22 16L24 18L24 20M12 20L10 22L10 28M24 20L26 22L26 28M10 28L26 28"
        stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="17" y="26" width="2" height="2" fill="#8b4513"/>
    </svg>
    <span className="auth-logo-text">InfraWatch</span>
  </div>
);

export default function Login() {
  const [form, setForm]       = useState({ email: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const { loginUser }         = useAuth();
  const navigate              = useNavigate();

  // 'login' -> normal sign-in form
  // 'forgot' -> enter email to request a reset code
  // 'reset'  -> enter the emailed code + a new password
  const [step, setStep]           = useState('login');

  // Since 'step' is internal state, not part of the URL, clicking the
  // navbar's "Login" link while already ON /login (just stuck in a
  // different step, like forgot-password) does nothing by default —
  // React Router doesn't remount when the pathname doesn't change. This
  // listens for a signal from that link to force the reset explicitly.
  useEffect(() => {
    const reset = () => setStep('login');
    window.addEventListener('reset-login-step', reset);
    return () => window.removeEventListener('reset-login-step', reset);
  }, []);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const [resetMsg, setResetMsg]   = useState('');
  const [resetError, setResetError] = useState('');

  const [code, setCode]                 = useState('');
  const [newPassword, setNewPassword]   = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetBusy, setResetBusy]       = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { data } = await login(form);
      loginUser(data.token, data.user);

      if (data.user.must_change_password) {
        navigate('/change-password');
      } else if (data.user.role === 'admin') {
        navigate('/admin');
      } else if (data.user.role === 'org_lead') {
        navigate('/staff');
      } else if (data.user.role === 'org_staff') {
        navigate('/staff/fuel-stations');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setResetError(''); setResetMsg(''); setResetSending(true);
    try {
      const { data } = await forgotPassword(resetEmail.trim());
      setResetMsg(data.message || 'If that email is registered, a reset code has been sent.');
      setStep('reset');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally { setResetSending(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setResetError('');
    if (!isPasswordComplex(newPassword)) { setResetError('Password does not meet the requirements below.'); return; }
    if (newPassword !== confirmPassword) { setResetError('Passwords do not match.'); return; }

    setResetBusy(true);
    try {
      await resetPassword({ email: resetEmail.trim(), code: code.trim(), newPassword });
      setStep('login');
      setError('');
      setResetMsg('');
      setForm({ email: resetEmail.trim(), password: '' });
      setCode(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Invalid or expired code. Please try again.');
    } finally { setResetBusy(false); }
  };

  const resendCode = async () => {
    setResetError(''); setResetMsg(''); setResetSending(true);
    try {
      const { data } = await forgotPassword(resetEmail.trim());
      setResetMsg(data.message || 'A new code has been sent.');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Could not resend code.');
    } finally { setResetSending(false); }
  };

  if (step === 'forgot') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Logo/>
          <h1>Forgot your password?</h1>
          <p className="sub">Enter your account email and we'll send a reset code to it.</p>

          <form className="auth-form" onSubmit={submitForgot}>
            <div className="field">
              <label>Email address</label>
              <input type="email" required autoComplete="email"
                value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="you@example.com"/>
            </div>
            {resetError && <div className="feedback-err">{resetError}</div>}
            <button className="btn btn-primary" type="submit" disabled={resetSending}>
              {resetSending ? 'Sending…' : 'Send reset code'}
            </button>
          </form>

          <p className="auth-switch">
            <button type="button" onClick={() => setStep('login')}
              style={{ background:'none', border:'none', color:'var(--navy-600)', textDecoration:'underline', cursor:'pointer', padding:0, font:'inherit' }}>
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (step === 'reset') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Logo/>
          <h1>Enter your reset code</h1>
          <p className="sub">Check <b>{resetEmail}</b> for a 6-digit code, then set a new password below.</p>

          {resetMsg && <div className="feedback-ok" style={{ marginBottom: '1rem' }}>{resetMsg}</div>}

          <form className="auth-form" onSubmit={submitReset}>
            <div className="field">
              <label>Reset Code</label>
              <input type="text" inputMode="numeric" maxLength={6} required autoComplete="one-time-code"
                value={code} onChange={e => setCode(e.target.value)} placeholder="123456"/>
            </div>
            <div className="field">
              <label>New Password</label>
              <PasswordInput required minLength={8} autoComplete="new-password"
                value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••"/>
              <PasswordRequirements password={newPassword} />
            </div>
            <div className="field">
              <label>Confirm New Password</label>
              <PasswordInput required minLength={6} autoComplete="new-password"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••"/>
            </div>
            {resetError && <div className="feedback-err">{resetError}</div>}
            <button className="btn btn-primary" type="submit" disabled={resetBusy}>
              {resetBusy ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>

          <p className="auth-switch">
            Didn't get a code?{' '}
            <button type="button" onClick={resendCode} disabled={resetSending}
              style={{ background:'none', border:'none', color:'var(--navy-600)', textDecoration:'underline', cursor:'pointer', padding:0, font:'inherit' }}>
              Resend code
            </button>
          </p>
          <p className="auth-switch">
            <button type="button" onClick={() => setStep('login')}
              style={{ background:'none', border:'none', color:'var(--navy-600)', textDecoration:'underline', cursor:'pointer', padding:0, font:'inherit' }}>
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo/>

        <h1>Welcome back</h1>
        <p className="sub">Sign in to your account to submit reports and track issues.</p>

        <form className="auth-form" onSubmit={submit}>
          <div className="field">
            <label>Email address</label>
            <input type="email" name="email" required autoComplete="email"
              value={form.email} onChange={handle} placeholder="you@example.com"/>
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput name="password" required autoComplete="current-password" blockClipboard={false}
              value={form.password} onChange={handle} placeholder="••••••••"/>
            <div style={{ textAlign: 'right', marginTop: '.35rem' }}>
              <button type="button" onClick={() => { setStep('forgot'); setResetEmail(form.email); }}
                style={{ background:'none', border:'none', color:'var(--navy-600)', textDecoration:'underline', cursor:'pointer', padding:0, font:'inherit', fontSize:'.82rem' }}>
                Forgot password?
              </button>
            </div>
          </div>
          {error && <div className="feedback-err">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          Don't have an account? <Link to="/register">Create one — it's free</Link>
        </p>
      </div>
    </div>
  );
}