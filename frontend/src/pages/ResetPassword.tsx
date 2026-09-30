// ResetPassword: destination of the emailed reset link (?token=...). Lets the user choose
// a new password and submits it with the token to the backend.
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { AuthVisualPanel } from '../components/AuthVisualPanel';
import { AuthIllustration } from '../components/illustrations';
import { FoxMark } from '../components/FoxMark';
import { Lock, AlertCircle, Loader2, ArrowLeft, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

/** Page component: shows the form, a success message, or an "invalid link" message if the token is missing. */
const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Checks token present and both passwords match, then calls the reset-password endpoint.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) { setError('This reset link is missing its token. Request a new one.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await authService.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reset your password.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <AuthVisualPanel
          tagline={'Map your knowledge,\none concept at a time'}
          description="Choose a new password to get back into your account."
          illustration={AuthIllustration}
        />

        <div className="flex-1 flex items-center justify-center p-6 relative overflow-y-auto">
          <div className="w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-primary transition-colors py-1.5 px-3 rounded-lg hover:bg-primary-muted"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Sign In</span>
              </Link>
            </div>

            <div className="flex lg:hidden items-center gap-2 justify-center mb-6">
              <FoxMark className="w-9 h-9" />
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-bold text-text-primary">Concept</span>
                <span className="text-xl font-bold text-primary">Intel</span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl shadow-card p-8">
              {done ? (
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h1 className="text-xl font-extrabold text-text-primary leading-none">Password reset</h1>
                  <p className="text-text-secondary text-sm mt-3">
                    Your password has been changed. You can now sign in with it.
                  </p>
                  <button onClick={() => navigate('/login')} className="btn-primary w-full justify-center mt-6">
                    Go to Sign In
                  </button>
                </div>
              ) : !token ? (
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                  </div>
                  <h1 className="text-xl font-extrabold text-text-primary leading-none">Invalid link</h1>
                  <p className="text-text-secondary text-sm mt-3">
                    This reset link is missing its token. Request a new one from the sign-in page.
                  </p>
                  <Link to="/forgot-password" className="btn-primary w-full justify-center mt-6 inline-flex">
                    Request a new link
                  </Link>
                </div>
              ) : (
                <>
                  <div className="mb-7">
                    <h1 className="text-2xl font-extrabold text-text-primary leading-none">Choose a new password</h1>
                    <p className="text-text-secondary text-sm mt-3">
                      Must include an uppercase and lowercase letter, a number, and a special character.
                    </p>
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 flex items-center gap-2 mb-6 text-sm animate-fade-in">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="new-password">
                        New password
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                          <Lock className="w-4 h-4" />
                        </span>
                        <input
                          id="new-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          className="input-light pl-10 pr-10"
                          placeholder="••••••••"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
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

                    <div>
                      <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="confirm-password">
                        Confirm new password
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                          <Lock className="w-4 h-4" />
                        </span>
                        <input
                          id="confirm-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          className="input-light pl-10"
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Resetting...</span>
                        </>
                      ) : (
                        <span>Reset password</span>
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
