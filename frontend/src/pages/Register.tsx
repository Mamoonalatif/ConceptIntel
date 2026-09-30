import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PasswordChecklist, isPasswordValid } from '../components/PasswordChecklist';
import { isValidEmail } from '../lib/validators';
import { apiErrorMessage } from '../lib/apiError';
import { FoxMark } from '../components/FoxMark';
import { FoxMascot } from '../components/FoxMascot';
import type { MascotRole } from '../components/FoxMascot';
import { Lock, Mail, User, AlertCircle, Loader2, Eye, EyeOff, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';

type RegPanelTab = 'student' | 'teacher' | 'admin';

const REG_PANEL_TABS: { id: RegPanelTab; label: string; tagline: string; desc: string; role: MascotRole; pose: 'focused' | 'confident' | 'happy' }[] = [
  { id: 'student', label: 'For Students', tagline: 'Your goals matter', desc: 'Explore your concept graph and follow an adaptive learning path tailored to your gaps.', role: 'student', pose: 'focused' },
  { id: 'teacher', label: 'For Teachers', tagline: 'Better Teaching,\nBrighter Futures', desc: 'Upload content, curate the AI concept graph, and supervise every output before students see it.', role: 'teacher', pose: 'confident' },
  { id: 'admin', label: 'For Admins', tagline: 'Institutional\nOversight, Simplified', desc: 'Platform-wide control over programs, staff accounts, and access requests.', role: 'admin', pose: 'happy' },
];

const RegLeftPanel: React.FC = () => {
  const [active, setActive] = useState<RegPanelTab>('student');
  const tab = REG_PANEL_TABS.find(t => t.id === active)!;
  return (
    <div className="hidden lg:flex lg:w-[44%] bg-gradient-to-br from-primary to-primary-hover relative overflow-hidden flex-col justify-between p-10">
      <div className="absolute top-[-80px] left-[-60px] w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-60px] right-[-40px] w-60 h-60 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="flex items-center gap-3 z-10">
        <FoxMark className="w-[38px] h-[38px]" tone="white" />
        <div className="flex items-baseline gap-0.5">
          <span className="text-white text-lg font-bold">Concept</span>
          <span className="text-white/70 text-lg font-bold">Intel</span>
        </div>
      </div>
      <div className="z-10 flex flex-col items-center text-center flex-1 justify-center">
        <div className="flex gap-1.5 mb-8 bg-white/15 rounded-full p-1">
          {REG_PANEL_TABS.map(t => (
            <button key={t.id} onClick={() => setActive(t.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200 ${
                active === t.id ? 'bg-white text-primary shadow-md' : 'text-white/80 hover:text-white hover:bg-white/20'
              }`}>{t.label}</button>
          ))}
        </div>
        <div className="transition-all duration-300">
          <FoxMascot key={tab.id} pose={tab.pose} role={tab.role} size={220} animated={true} />
        </div>
        <h2 className="mt-6 text-2xl font-extrabold text-white leading-snug whitespace-pre-line">{tab.tagline}</h2>
        <p className="mt-3 text-white/75 text-sm leading-relaxed max-w-xs">{tab.desc}</p>
        <div className="mt-6 inline-flex items-center gap-2 bg-white/15 border border-white/25 px-4 py-1.5 rounded-full">
          <span className="text-xs font-bold text-white tracking-wide uppercase">{tab.label}</span>
        </div>
      </div>
      <p className="z-10 text-white/50 text-xs text-center">Different Roles · Same Goal — Smarter Learning Together</p>
    </div>
  );
};

const FULL_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const ILLEGAL_NAME_CHAR_PATTERN = /[^A-Za-z ]/;

const Register: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fullNameError, setFullNameError] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const confirmMismatch = confirmTouched && confirmPassword.length > 0 && confirmPassword !== password;
  const confirmMatches = confirmPassword.length > 0 && confirmPassword === password;
  const emailInvalid = email.length > 0 && !isValidEmail(email);

  const validateFullName = (value: string) => {
    if (!value.trim()) { setFullNameError('Full name is required'); return false; }
    if (!FULL_NAME_PATTERN.test(value.trim())) { setFullNameError('Only letters and spaces are allowed'); return false; }
    setFullNameError(''); return true;
  };

  const handleFullNameChange = (value: string) => {
    setFullName(value);
    if (ILLEGAL_NAME_CHAR_PATTERN.test(value)) {
      setFullNameError('Only letters and spaces are allowed (no digits or symbols)');
    } else if (fullNameError) { validateFullName(value); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const isNameValid = validateFullName(fullName);
    if (!isNameValid) return;
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    if (!isPasswordValid(password)) { setError('Password does not meet the requirements below.'); return; }
    setConfirmTouched(true);
    if (password !== confirmPassword) return;
    setLoading(true);
    try {
      await register({ email, password, full_name: fullName.trim(), role: 'student' });
      // The account is created but unverified (see backend/app/auth/routes.py
      // register()) - login will 403 until the emailed link is clicked. The
      // ?verify=1 flag tells Login.tsx to show that explanation instead of
      // silently landing back on a blank sign-in form.
      const base = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
      navigate(`${base}${base.includes('?') ? '&' : '?'}verify=1`);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Registration failed. Check inputs.'));
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <RegLeftPanel />

        {/* Right: Register Form */}
        <div className="flex-1 flex items-center justify-center p-6 relative overflow-y-auto">
          <div className="w-full max-w-md py-8">
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
              <FoxMark className="w-[34px] h-[34px]" />
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-bold text-text-primary">Concept</span>
                <span className="text-xl font-bold text-primary">Intel</span>
              </div>
            </div>

          <div className="glass-panel rounded-3xl shadow-card p-8 animate-fade-up relative">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-2xl font-extrabold text-text-primary">Create Account</h1>
                <p className="text-text-secondary text-sm mt-1">Join ConceptIntel as a student</p>
              </div>
              <div className="shrink-0 -mr-2 -mt-4">
                <FoxMascot pose={password.length > 0 && !showPassword ? 'peeking' : 'waving'} size={80} animated={true} />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 flex items-center gap-2 mb-5 text-sm animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="fullName">
                  Full Name
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                    <User className="w-4 h-4" />
                  </span>
                  <input
                    id="fullName"
                    type="text"
                    required
                    className={`input-light pl-10 ${fullNameError ? 'input-error' : ''}`}
                    placeholder="Your full name"
                    value={fullName}
                    onChange={(e) => handleFullNameChange(e.target.value)}
                    onBlur={(e) => validateFullName(e.target.value)}
                  />
                </div>
                {fullNameError && (
                  <p className="text-xs text-red-600 mt-1.5">{fullNameError}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="reg-email">
                  Email Address
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    id="reg-email"
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
                <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="reg-password">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    className={`input-light pl-10 pr-10 ${password && !isPasswordValid(password) ? 'input-error' : ''}`}
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setPasswordFocused(true)}
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

                <PasswordChecklist password={password} visible={passwordFocused} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="confirm-password">
                  Confirm Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    className={`input-light pl-10 pr-10 ${confirmMismatch ? 'input-error' : ''}`}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onFocus={() => {
                      setConfirmTouched(true);
                      setPasswordFocused(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-text-muted hover:text-text-secondary"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmMismatch ? (
                  <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    Passwords do not match
                  </p>
                ) : confirmMatches ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 mt-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Passwords match
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                id="register-submit"
                disabled={loading}
                className="btn-primary w-full justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating Account...</span>
                  </>
                ) : (
                  <span>Create Account</span>
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-border text-center space-y-2">
              <p className="text-sm text-text-secondary">
                Already have an account?{' '}
                <Link to="/login" className="text-primary font-semibold hover:text-primary-hover hover:underline transition-colors">
                  Sign in
                </Link>
              </p>
              <p className="text-sm text-text-secondary">
                Want to teach?{' '}
                <Link to="/request-teacher-access" className="text-secondary font-semibold hover:text-secondary-hover hover:underline transition-colors">
                  Request teacher access
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

export default Register;
