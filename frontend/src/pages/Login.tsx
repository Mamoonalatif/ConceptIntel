import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { isValidEmail } from '../lib/validators';
import { AuthVisualPanel } from '../components/AuthVisualPanel';
import { AuthIllustration } from '../components/illustrations';
import logo from '../assets/logo.png';
import { Lock, Mail, AlertCircle, Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const dashboardPathForRole = (role: string) => {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  if (role === 'program_coordinator') return '/program-coordinator';
  if (role === 'course_coordinator') return '/course-coordinator';
  return '/student';
};

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const emailInvalid = email.length > 0 && !isValidEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    setLoading(true);
    try {
      const data = await login({ email, password }, rememberMe);
      navigate(redirect || dashboardPathForRole(data.role));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid email or password');
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <AuthVisualPanel
          tagline={'Map your knowledge,\none concept at a time'}
          description="Sign in to pick up your courses, track prerequisites, and explore AI-generated concept maps."
          illustration={AuthIllustration}
        />

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
              <img src={logo} alt="ConceptIntel" width={36} height={36} className="w-9 h-9 object-contain" />
              <div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-xl font-bold text-text-primary">Concept</span>
                  <span className="text-xl font-bold text-primary">Intel</span>
                </div>
              </div>
            </div>

          <div className="glass-panel rounded-2xl shadow-card p-8">
            <div className="mb-7">
              <h1 className="text-2xl font-extrabold text-text-primary leading-none">Welcome back</h1>
              <p className="text-text-secondary text-sm mt-3">Sign in to your ConceptIntel account to continue</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 flex items-center gap-2 mb-6 text-sm animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
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
