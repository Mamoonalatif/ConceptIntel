import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authService } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { AuthVisualPanel } from '../components/AuthVisualPanel';
import { AuthIllustration } from '../components/illustrations';
import { FoxMark } from '../components/FoxMark';
import { AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

/* Consumes the token from a "verify your email" link (see
   backend/app/auth/routes.py verify_email / send_verification_email). Fires the
   confirmation automatically on load - there's nothing for the user to fill in,
   just a link they clicked. */
/** Page component. status: 'loading' (verifying link), 'code' (manual 6-digit code entry, used when there is no token), 'success' or 'error'. */
const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'code'>(token ? 'loading' : 'code');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Manual fallback: verifies the account with email + 6-digit code instead of the link.
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await authService.verifyEmailCode(email.trim(), code.trim());
      setStatus('success');
    } catch (err) {
      setError(apiErrorMessage(err, 'That code is invalid or has expired.'));
    } finally {
      setSubmitting(false);
    }
  };

  // If the URL has a token, verify it automatically on load.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await authService.verifyEmail(token);
        if (!cancelled) setStatus('success');
      } catch (err) {
        if (!cancelled) {
          setError(apiErrorMessage(err, 'This verification link is invalid or has expired.'));
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <AuthVisualPanel
          tagline={'One last step'}
          description="Confirm your email address to finish creating your account."
          illustration={AuthIllustration}
        />

        <div className="flex-1 flex items-center justify-center p-6 relative overflow-y-auto">
          <div className="w-full max-w-md">
            <div className="flex lg:hidden items-center gap-2 justify-center mb-6">
              <FoxMark className="w-9 h-9" />
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-bold text-text-primary">Concept</span>
                <span className="text-xl font-bold text-primary">Intel</span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl shadow-card p-8 text-center py-2">
              {status === 'loading' && (
                <>
                  <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
                  <h1 className="text-xl font-extrabold text-text-primary leading-none">Verifying your email...</h1>
                </>
              )}

              {status === 'code' && (
                <form onSubmit={submitCode} className="text-left">
                  <h1 className="text-xl font-extrabold text-text-primary leading-none text-center">Enter your verification code</h1>
                  <p className="text-text-secondary text-sm mt-3 text-center">
                    Type the 6-digit code from your verification email.
                  </p>
                  <input
                    type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu" className="input-field w-full mt-5"
                  />
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456" className="input-field w-full mt-3 text-center tracking-[0.5em] font-bold"
                  />
                  {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
                  <button type="submit" disabled={submitting || code.length !== 6} className="btn-primary w-full justify-center mt-5 inline-flex">
                    {submitting ? 'Verifying...' : 'Verify'}
                  </button>
                  <Link to="/login" className="block text-center text-sm text-text-secondary mt-4">Back to Sign In</Link>
                </form>
              )}

              {status === 'success' && (
                <>
                  <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h1 className="text-xl font-extrabold text-text-primary leading-none">Email verified</h1>
                  <p className="text-text-secondary text-sm mt-3">
                    Your email address has been confirmed. You can now sign in.
                  </p>
                  <Link to="/login" className="btn-primary w-full justify-center mt-6 inline-flex">
                    Go to Sign In
                  </Link>
                </>
              )}

              {status === 'error' && (
                <>
                  <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                  </div>
                  <h1 className="text-xl font-extrabold text-text-primary leading-none">Verification failed</h1>
                  <p className="text-text-secondary text-sm mt-3">{error}</p>
                  <Link to="/login" className="btn-primary w-full justify-center mt-6 inline-flex">
                    Back to Sign In
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
