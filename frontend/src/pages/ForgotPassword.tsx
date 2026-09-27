import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/api';
import { isValidEmail } from '../lib/validators';
import { AuthVisualPanel } from '../components/AuthVisualPanel';
import { AuthIllustration } from '../components/illustrations';
import { FoxMark } from '../components/FoxMark';
import { Mail, AlertCircle, Loader2, ArrowLeft, MailCheck } from 'lucide-react';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const emailInvalid = email.length > 0 && !isValidEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    setLoading(true);
    try {
      // Backend always returns the same generic message whether or not the email
      // exists, so there is nothing to branch on here - just show the confirmation.
      await authService.forgotPassword(email);
      setSent(true);
    } catch {
      // A network/5xx failure, not "email not found" (the backend never says that).
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <AuthVisualPanel
          tagline={'Map your knowledge,\none concept at a time'}
          description="We'll help you get back into your account in no time."
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
              {sent ? (
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                    <MailCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h1 className="text-xl font-extrabold text-text-primary leading-none">Check your email</h1>
                  <p className="text-text-secondary text-sm mt-3">
                    If an account exists for <strong>{email}</strong>, we've sent a link to reset your password.
                    It expires in 30 minutes.
                  </p>
                  <Link to="/login" className="btn-primary w-full justify-center mt-6 inline-flex">
                    Back to Sign In
                  </Link>
                </div>
              ) : (
                <>
                  <div className="mb-7">
                    <h1 className="text-2xl font-extrabold text-text-primary leading-none">Forgot your password?</h1>
                    <p className="text-text-secondary text-sm mt-3">
                      Enter the email on your account and we'll send you a link to reset it.
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

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <span>Send reset link</span>
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

export default ForgotPassword;
