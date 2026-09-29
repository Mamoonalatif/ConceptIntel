import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { isValidEmail } from '../lib/validators';
import { authService } from '../services/api';
import { FoxMark } from '../components/FoxMark';
import { FoxMascot } from '../components/FoxMascot';
import type { MascotRole } from '../components/FoxMascot';
import { Lock, Mail, AlertCircle, Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const dashboardPathForRole = (role: string) => {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
};

/* ------------------------------------------------------------------
   Left Panel Tabs — Student / Teacher / Admin role Fox getups
   matching the inspiration identity sheet.
------------------------------------------------------------------ */
type PanelTab = 'student' | 'teacher' | 'admin';

const PANEL_TABS: { id: PanelTab; label: string; tagline: string; desc: string; role: MascotRole; pose: 'focused' | 'confident' | 'happy' }[] = [
  {
    id: 'student',
    label: 'For Students',
    tagline: 'Your goals matter',
    desc: 'Explore your concept graph, follow adaptive paths and track where you stand — concept by concept.',
    role: 'student',
    pose: 'focused',
  },
  {
    id: 'teacher',
    label: 'For Teachers',
    tagline: 'Better Teaching,\nBrighter Futures',
    desc: 'Upload content, curate the AI concept graph, and supervise every output before students see it.',
    role: 'teacher',
    pose: 'confident',
  },
  {
    id: 'admin',
    label: 'For Admins',
    tagline: 'Institutional\nOversight, Simplified',
    desc: 'Platform-wide control over programs, staff accounts, access requests and institutional analytics.',
    role: 'admin',
    pose: 'happy',
  },
];

const LeftPanel: React.FC = () => {
  const [active, setActive] = useState<PanelTab>('student');
  const tab = PANEL_TABS.find(t => t.id === active)!;

  return (
    <div className="hidden lg:flex lg:w-[44%] bg-gradient-to-br from-primary to-primary-hover relative overflow-hidden flex-col justify-between p-10">
      {/* Decorative blobs */}
      <div className="absolute top-[-80px] left-[-60px] w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-60px] right-[-40px] w-60 h-60 rounded-full bg-white/10 blur-3xl pointer-events-none" />

      {/* Logo */}
      <div className="flex items-center gap-3 z-10">
        <FoxMark className="w-[38px] h-[38px]" tone="white" />
        <div className="flex items-baseline gap-0.5">
          <span className="text-white text-lg font-bold">Concept</span>
          <span className="text-white/70 text-lg font-bold">Intel</span>
        </div>
      </div>

      {/* Role Tabs */}
      <div className="z-10 flex flex-col items-center text-center flex-1 justify-center">
        {/* Tab pills */}
        <div className="flex gap-1.5 mb-8 bg-white/15 rounded-full p-1">
          {PANEL_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200 ${active === t.id
                  ? 'bg-white text-primary shadow-md'
                  : 'text-white/80 hover:text-white hover:bg-white/20'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Fox mascot with role-based getup */}
        <div className="transition-all duration-300">
          <FoxMascot
            key={tab.id}
            pose={tab.pose}
            role={tab.role}
            size={220}
            animated={true}
          />
        </div>

        {/* Tagline & description */}
        <h2 className="mt-6 text-2xl font-extrabold text-white leading-snug whitespace-pre-line">
          {tab.tagline}
        </h2>
        <p className="mt-3 text-white/75 text-sm leading-relaxed max-w-xs">
          {tab.desc}
        </p>

        {/* Role badge */}
        <div className="mt-6 inline-flex items-center gap-2 bg-white/15 border border-white/25 px-4 py-1.5 rounded-full">
          <span className="text-xs font-bold text-white tracking-wide uppercase">
            {tab.label}
          </span>
        </div>
      </div>

      {/* Bottom tagline */}
      <p className="z-10 text-white/50 text-xs text-center">
        Different Roles · Same Goal — Smarter Learning Together
      </p>
    </div>
  );
};

const Login: React.FC = () => {
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Set once the password check succeeds for a 2FA-enabled account - switches the
  // form to the "enter your authenticator code" step. See AuthContext.login /
  // backend/app/auth/routes.py login() for where this comes from.
  const [twoFactorTempToken, setTwoFactorTempToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  // True when a login attempt failed specifically because the account's email
  // isn't verified yet (see backend/app/auth/routes.py login()'s 403) - offers a
  // "resend the link" action instead of just a generic error.
  const [unverified, setUnverified] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const justRegistered = searchParams.get('verify') === '1';

  const emailInvalid = email.length > 0 && !isValidEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    setLoading(true);
    try {
      const data = await login({ email, password }, rememberMe);
      if (data?.requires_2fa) {
        setTwoFactorTempToken(data.temp_token);
        setLoading(false);
        return;
      }
      navigate(redirect || dashboardPathForRole(data.role));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid email or password');
      setUnverified(err.response?.status === 403 && /verify your email/i.test(err.response?.data?.detail || ''));
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setResendState('sending');
    try {
      await authService.resendVerification(email);
      setResendState('sent');
    } catch {
      setResendState('idle');
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorTempToken) return;
    setError('');
    setLoading(true);
    try {
      const data = await verifyTwoFactor(twoFactorTempToken, twoFactorCode.trim(), rememberMe);
      navigate(redirect || dashboardPathForRole(data.role));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid authentication code.');
      setLoading(false);
    }
  };

  if (twoFactorTempToken) {
    return (
      <div className="h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md glass-panel rounded-3xl shadow-card p-8">
          <h1 className="text-2xl font-extrabold text-text-primary leading-none">Two-factor authentication</h1>
          <p className="text-text-secondary text-sm mt-2 mb-6">
            Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 flex items-center gap-2 mb-6 text-sm animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleVerifyTwoFactor} className="space-y-5">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              className="input-light text-center tracking-[0.3em] text-lg"
              placeholder="000000"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading || !twoFactorCode}
              className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Verify</span>}
            </button>
            <button
              type="button"
              className="w-full text-sm font-semibold text-text-secondary hover:text-primary transition-colors"
              onClick={() => { setTwoFactorTempToken(null); setTwoFactorCode(''); setError(''); }}
            >
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel with Tabbed Fox Roles */}
        <LeftPanel />

        {/* Right Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 relative overflow-y-auto">
          <div className="w-full max-w-md">
            {/* Top Navigation Bar: Back to Home */}
            <div className="flex items-center justify-between mb-6">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-primary transition-colors py-1.5 px-3 rounded-lg hover:bg-primary-muted"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Home</span>
              </Link>
            </div>

            {/* Mobile Logo */}
            <div className="flex lg:hidden items-center gap-2 justify-center mb-6">
              <FoxMark className="w-9 h-9" />
              <div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-xl font-bold text-text-primary">Concept</span>
                  <span className="text-xl font-bold text-primary">Intel</span>
                </div>
              </div>
            </div>

            <div className="glass-panel rounded-3xl shadow-card p-8 relative">
              {/* Header with reactive Fox */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-2xl font-extrabold text-text-primary leading-none">Welcome back</h1>
                  <p className="text-text-secondary text-sm mt-2">Sign in to your ConceptIntel account</p>
                </div>
                <div className="shrink-0 -mr-2 -mt-4">
                  <FoxMascot
                    pose={password.length > 0 && !showPassword ? 'peeking' : 'happy'}
                    role="default"
                    size={80}
                    animated={true}
                  />
                </div>
              </div>

              {!error && justRegistered && (
                <div className="bg-primary-muted border border-primary/20 text-primary rounded-xl p-3.5 flex items-center gap-2 mb-6 text-sm animate-fade-in">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>Account created! Check your email for a verification link before signing in.</span>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 flex flex-col gap-2 mb-6 text-sm animate-fade-in">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                  {unverified && (
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resendState !== 'idle'}
                      className="self-start text-xs font-semibold text-red-700 hover:underline disabled:opacity-60"
                    >
                      {resendState === 'sent' ? 'Verification email sent - check your inbox.' : resendState === 'sending' ? 'Sending...' : 'Resend verification email'}
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="email">
                    Email Address
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                      <Mail className="w-4 h-4" />
                    </span>
                    <input
                      id="email"
                      type="email"
                      required
                      className={`input-light pl-10 ${emailInvalid ? 'input-error' : ''}`}
                      placeholder="you@university.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  {emailInvalid && (
                    <p className="text-xs text-red-600 mt-1.5">Enter a valid email address</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      className="input-light pl-10 pr-10"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-text-muted hover:text-text-secondary"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                    <input
                      id="remember-me"
                      type="checkbox"
                      className="rounded border-border text-primary focus:ring-primary/40"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    Remember me
                  </label>
                  <Link to="/forgot-password" className="text-sm font-semibold text-primary hover:text-primary-hover hover:underline transition-colors">
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  id="login-submit"
                  className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing In...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </form>

              <div className="flex items-center gap-3 my-6">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-text-muted">OR</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <GoogleSignInButton
                rememberMe={rememberMe}
                onSuccess={(role) => navigate(redirect || dashboardPathForRole(role))}
                onError={setError}
                onRequiresTwoFactor={(tempToken) => setTwoFactorTempToken(tempToken)}
              />

              <div className="mt-6 pt-6 border-t border-border text-center">
                <p className="text-sm text-text-secondary">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-primary font-semibold hover:text-primary-hover hover:underline transition-colors">
                    Register here
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
