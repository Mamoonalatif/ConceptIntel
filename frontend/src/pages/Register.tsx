import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PasswordChecklist, isPasswordValid } from '../components/PasswordChecklist';
import { isValidEmail } from '../lib/validators';
import { AuthVisualPanel } from '../components/AuthVisualPanel';
import { AuthIllustration } from '../components/illustrations';
import logo from '../assets/logo.png';
import { Lock, Mail, User, AlertCircle, Loader2, Eye, EyeOff, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';

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
      navigate(redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Check inputs.');
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <AuthVisualPanel
          tagline={'Start your\nlearning journey'}
          description="Create your account and join students mapping knowledge at universities worldwide."
          illustration={AuthIllustration}
        />

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
              <img src={logo} alt="ConceptIntel" width={34} height={34} className="w-[34px] h-[34px] object-contain" />
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-bold text-text-primary">Concept</span>
                <span className="text-xl font-bold text-primary">Intel</span>
              </div>
            </div>

          <div className="glass-panel rounded-2xl shadow-card p-8 animate-fade-up">
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold text-text-primary">Create Account</h1>
              <p className="text-text-secondary text-sm mt-2">Join ConceptIntel as a student to start mapping concepts</p>
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
