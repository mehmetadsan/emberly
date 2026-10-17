import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Flame, Mail, LockKeyhole, Sparkles } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { useAuth } from '../App.jsx';

function AuthFrame({ children, subtitle }) {
  return <main className="auth-screen"><div className="auth-orb orb-one" /><div className="auth-orb orb-two" />
    <section className="auth-card"><Link to="/" className="auth-brand"><span className="brand-mark"><Flame fill="currentColor" /></span><span><b>emberly</b><i>Keep your spark alive.</i></span></Link>
      <div className="auth-heading"><h1>{subtitle}</h1><p>Small steps. Brighter days.</p></div>{children}
      <p className="auth-footer">By continuing, you agree to make room for a little progress.</p>
    </section>
  </main>;
}

function Field({ label, type = 'text', value, onChange, placeholder, required = true, icon: Icon }) {
  const [visible, setVisible] = useState(false);
  const actualType = type === 'password' && visible ? 'text' : type;
  return <label className="form-field"><span>{label}</span><div className="input-wrap">{Icon && <Icon size={17} />}<input required={required} type={actualType} value={value} onChange={onChange} placeholder={placeholder} autoComplete={type === 'password' ? 'current-password' : undefined} />
    {type === 'password' && <button type="button" className="password-toggle" onClick={() => setVisible(!visible)} aria-label="Toggle password visibility">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>}</div>
  </label>;
}

export function AuthPage({ register = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(localStorage.getItem('emberly_pending_email') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = requireApi();
  const redirectTo = () => {
    const returnTo = params.get('returnTo') || '/';
    return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  };
  if (user) return <Navigate to={register ? '/' : redirectTo()} replace />;
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (register && password !== confirm) { setError('Passwords do not match.'); return; }
    if (register && password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    setBusy(true);
    try {
      if (register) {
        const { error: authError } = await client.auth.signUp({ email, password, options: { data: { display_name: name.trim() } } });
        if (authError) throw authError;
        localStorage.removeItem('emberly_pending_email');
        navigate('/', { replace: true });
      } else {
        const { error: authError } = await client.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        localStorage.removeItem('emberly_pending_email');
        navigate(redirectTo(), { replace: true });
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <AuthFrame subtitle={register ? 'Create your account' : 'Welcome back'}>
    <form className="auth-form" onSubmit={submit}>
      <p>{register ? 'Create an account to start building habits with your people.' : 'Sign in to pick up where you left off.'}</p>
      {register && <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan" icon={Sparkles} />}
      <Field label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" icon={Mail} />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" icon={LockKeyhole} />
      {register && <Field label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" icon={LockKeyhole} />}
      {!register && <Link className="forgot-link" to="/forgot-password">Forgot password?</Link>}
      {error && <p className={error.includes('sent') ? 'notice success' : 'notice error'}>{error}</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
      <p className="auth-switch">{register ? 'Already have an account?' : 'New to Emberly?'} <Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>
    </form>
  </AuthFrame>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const { error: resetError } = await requireApi().auth.resetPasswordForEmail(email);
    if (resetError) setError(resetError.message);
    else setSent(true);
    setBusy(false);
  };
  return <AuthFrame subtitle="Reset your password">{sent ? <div className="success-panel"><span>✉</span><h2>Request received</h2><p>If an account exists, instructions will be sent after an email provider is configured. For this local SQLite setup, contact the app administrator to reset your password.</p></div> : <form className="auth-form" onSubmit={submit}><p>Enter your email to request a password reset.</p><Field label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" icon={Mail} />{error && <p className="notice error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Sending…' : 'Request password reset'}</button></form>}<Link className="back-link" to="/login"><ArrowLeft size={16} /> Back to sign in</Link></AuthFrame>;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (password.length < 8 || password !== confirm) { setError('Passwords must match and contain at least 8 characters.'); return; }
    setBusy(true);
    const { error: updateError } = await requireApi().auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else navigate('/login', { replace: true });
    setBusy(false);
  };
  return <AuthFrame subtitle="Choose a new password"><form className="auth-form" onSubmit={submit}><Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" icon={LockKeyhole} /><Field label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" icon={LockKeyhole} />{error && <p className="notice error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button></form></AuthFrame>;
}
