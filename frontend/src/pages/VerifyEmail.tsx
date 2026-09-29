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
const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(token ? 'loading' : 'error');
  const [error, setError] = useState(token ? '' : 'This verification link is missing its token.');

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
