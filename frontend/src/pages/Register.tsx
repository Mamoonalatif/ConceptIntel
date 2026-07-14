import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brain, Lock, Mail, User, AlertCircle, Loader2, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';

const FULL_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const SPECIAL_CHARS = '!@#$%^&*';

const passwordChecks = (password: string) => ({
  length: password.length >= 8,
  upper: /[A-Z]/.test(password),
  lower: /[a-z]/.test(password),
  digit: /[0-9]/.test(password),
  special: [...password].some((ch) => SPECIAL_CHARS.includes(ch)),
});

const Register: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fullNameError, setFullNameError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checks = passwordChecks(password);
  const passwordValid = Object.values(checks).every(Boolean);

  const validateFullName = (value: string) => {
    if (!value.trim()) {
      setFullNameError('Full name is required');
      return false;
    }
    if (!FULL_NAME_PATTERN.test(value.trim())) {
      setFullNameError('Only letters and spaces are allowed (no digits or symbols)');
      return false;
    }
    setFullNameError('');
    return true;
  };

  const handleFullNameChange = (value: string) => {
    setFullName(value);
    if (fullNameError) validateFullName(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const isNameValid = validateFullName(fullName);
    if (!isNameValid) return;

    if (!passwordValid) {
      setError('Password does not meet the requirements below.');
      return;
    }

    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match');
      return;
    }
    setConfirmError('');

    setLoading(true);
    try {
      await register({ email, password, full_name: fullName.trim(), role: 'student' });
      navigate('/login');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Check inputs.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      <div className="page-bg-decoration" />

      <div className="w-full max-w-md z-10">
        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-card">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold gradient-text">ConceptIntel</span>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-card animate-fade-up">
          <div className="mb-6">
            <h1 className="text-2xl font-extrabold text-text-primary">Create Account</h1>
            <p className="text-text-secondary text-sm mt-1">Join ConceptIntel as a student to start mapping concepts</p>
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
                  className="input-light pl-10"
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
                  className="input-light pl-10"
                  placeholder="you@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
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
                  className="input-light pl-10 pr-10"
                  placeholder="Min. 8 characters"
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

              {/* Requirements checklist */}
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {[
                  { key: 'length', label: 'At least 8 characters' },
                  { key: 'upper', label: 'One uppercase letter' },
                  { key: 'lower', label: 'One lowercase letter' },
                  { key: 'digit', label: 'One digit' },
                  { key: 'special', label: `One special char (${SPECIAL_CHARS})` },
                ].map(({ key, label }) => {
                  const passed = (checks as any)[key];
                  return (
                    <li key={key} className={`flex items-center gap-1.5 ${passed ? 'text-emerald-600' : 'text-text-muted'}`}>
                      {passed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                      {label}
                    </li>
                  );
                })}
              </ul>
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
                  className="input-light pl-10 pr-10"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (confirmError) setConfirmError('');
                  }}
                  onBlur={() => {
                    if (confirmPassword && confirmPassword !== password) {
                      setConfirmError('Passwords do not match');
                    }
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
              {confirmError && (
                <p className="text-xs text-red-600 mt-1.5">{confirmError}</p>
              )}
            </div>

            <button
              type="submit"
              id="register-submit"
              disabled={loading}
              className="w-full py-3 mt-2 bg-gradient-to-r from-primary to-secondary hover:from-primary-hover hover:to-secondary-hover text-white font-bold rounded-xl transition-all shadow-glow active:scale-[0.98] disabled:opacity-60 disabled:scale-100 flex items-center justify-center gap-2 text-sm"
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
              <Link to="/login" className="text-primary font-semibold hover:text-primary-hover transition-colors">
                Sign in
              </Link>
            </p>
            <p className="text-sm text-text-secondary">
              Want to teach?{' '}
              <Link to="/request-teacher-access" className="text-secondary font-semibold hover:text-secondary-hover transition-colors">
                Request teacher access
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
