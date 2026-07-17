import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { isValidEmail } from '../lib/validators';
import { Brain, Lock, Mail, AlertCircle, Loader2, Sparkles, BookOpen, Network, Eye, EyeOff } from 'lucide-react';

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
  // e.g. /login?redirect=/join/ABCD1234 - sends the user straight back to the join
  // link they clicked instead of their default dashboard, after signing in.
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

    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }

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
    <div className="min-h-screen bg-background flex">
      {/* Left Hero Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-secondary relative overflow-hidden flex-col justify-between p-12">
        {/* Decorative circles */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-white/5 rounded-full translate-x-1/3 translate-y-1/3" />
        <div className="absolute top-1/2 right-0 w-64 h-64 bg-white/5 rounded-full translate-x-1/2 -translate-y-1/2" />

        {/* Logo */}
        <div className="flex items-center gap-3 z-10">
          <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">ConceptIntel</span>
        </div>

        {/* Feature Pills */}
        <div className="z-10 space-y-6">
          <div>
            <h2 className="text-4xl font-extrabold text-white leading-tight">
              AI-Powered<br />Knowledge Graphs<br />for Education
            </h2>
            <p className="mt-4 text-white/70 text-base leading-relaxed max-w-sm">
              Automatically extract concepts from course materials, map prerequisites, and track student mastery in real-time.
            </p>
          </div>

          <div className="space-y-3">
            {[
              { icon: Sparkles, text: 'AI concept extraction from PDFs & slides' },
              { icon: Network,   text: 'Interactive prerequisite knowledge graphs' },
              { icon: BookOpen,  text: 'Adaptive learning paths for students' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl px-4 py-3">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <span className="text-white/90 text-sm font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/40 text-xs z-10">© 2026 ConceptIntel · Final Year Project</p>
      </div>

      {/* Right Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 relative">
        <div className="page-bg-decoration" />

        <div className="w-full max-w-md z-10">
          {/* Mobile Logo */}
          <div className="flex lg:hidden items-center gap-2 justify-center mb-8">
            <div className="w-10 h-10 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text">ConceptIntel</span>
          </div>

          <div className="glass-panel rounded-2xl p-8 shadow-card">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold text-text-primary">Welcome back</h1>
              <p className="text-text-secondary text-sm mt-1">Sign in to your ConceptIntel account</p>
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
                className="w-full py-3 bg-gradient-to-r from-primary to-secondary hover:from-primary-hover hover:to-secondary-hover text-white font-bold rounded-xl transition-all shadow-glow active:scale-[0.98] disabled:opacity-60 disabled:scale-100 flex items-center justify-center gap-2 text-sm"
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
                <Link to="/register" className="text-primary font-semibold hover:text-primary-hover transition-colors">
                  Register here
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
