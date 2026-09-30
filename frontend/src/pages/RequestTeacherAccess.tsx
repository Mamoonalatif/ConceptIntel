// RequestTeacherAccess: public form where a prospective teacher asks for access; an
// admin later reviews the request and creates the account.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { AuthVisualPanel } from '../components/AuthVisualPanel';
import { TeacherAccessIllustration } from '../components/illustrations';
import { FoxMark } from '../components/FoxMark';
import { Mail, User, MessageSquare, AlertCircle, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';

// Full name: letters separated by single spaces.
const FULL_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

/** Page component: request form, replaced by a confirmation once submitted. */
const RequestTeacherAccess: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [fullNameError, setFullNameError] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Checks the name is non-empty and letters/spaces only; sets the inline error and returns validity.
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

  // Validates the name and posts the request (name, email, optional message) to the backend.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validateFullName(fullName)) return;

    setLoading(true);
    try {
      await authService.requestTeacherAccess({ email, full_name: fullName.trim(), reason: reason || undefined });
      setSubmitted(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to submit request. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <AuthVisualPanel
          tagline={'Share your\nexpertise'}
          description="Request teacher access to create courses, upload materials, and build concept maps for your students."
          illustration={TeacherAccessIllustration}
        />

        {/* Right: Request Form */}
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
              <FoxMark className="w-9 h-9" />
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-bold text-text-primary">Concept</span>
                <span className="text-xl font-bold text-primary">Intel</span>
              </div>
            </div>

          <div className="glass-panel rounded-2xl shadow-card p-8 animate-fade-up">
          {submitted ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h1 className="text-xl font-extrabold text-text-primary mb-2">Request Submitted</h1>
              <p className="text-text-secondary text-sm mb-6">
                An administrator will review your request and relay login credentials to your email if approved.
              </p>
              <Link to="/login" className="text-primary font-semibold hover:text-primary-hover hover:underline transition-colors text-sm">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-extrabold text-text-primary">Request Teacher Access</h1>
                <p className="text-text-secondary text-sm mt-1">
                  Tell us a bit about yourself. An admin will review your request and create your account.
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3.5 flex items-center gap-2 mb-5 text-sm animate-fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="req-fullName">
                    Full Name
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                      <User className="w-4 h-4" />
                    </span>
                    <input
                      id="req-fullName"
                      type="text"
                      required
                      className="input-light pl-10"
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        if (fullNameError) validateFullName(e.target.value);
                      }}
                      onBlur={(e) => validateFullName(e.target.value)}
                    />
                  </div>
                  {fullNameError && <p className="text-xs text-red-600 mt-1.5">{fullNameError}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="req-email">
                    Email Address
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                      <Mail className="w-4 h-4" />
                    </span>
                    <input
                      id="req-email"
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
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5" htmlFor="req-reason">
                    Message (optional)
                  </label>
                  <div className="relative">
                    <span className="absolute top-3 left-0 pl-3.5 flex items-center text-text-muted pointer-events-none">
                      <MessageSquare className="w-4 h-4" />
                    </span>
                    <textarea
                      id="req-reason"
                      rows={3}
                      className="input-light pl-10 resize-none"
                      placeholder="Tell us which courses you'd like to teach..."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Request</span>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-border text-center">
                <p className="text-sm text-text-secondary">
                  <Link to="/login" className="text-primary font-semibold hover:text-primary-hover hover:underline transition-colors">
                    Back to Sign In
                  </Link>
                </p>
              </div>
            </>
          )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default RequestTeacherAccess;
