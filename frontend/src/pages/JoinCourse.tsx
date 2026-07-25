import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { courseService, enrollmentService, type CourseLookup } from '../services/api';
import { CheckCircle2, AlertCircle, Loader2, LogIn } from 'lucide-react';

/* Shared logo mark */
const LogoMark: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="jlg1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2563eb" /><stop offset="100%" stopColor="#7c3aed" />
      </linearGradient>
      <linearGradient id="jlg2" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#4f46e5" /><stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="10" fill="url(#jlg1)" />
    <circle cx="12" cy="20" r="3.5" fill="white" opacity="0.95" />
    <circle cx="20" cy="12" r="3.5" fill="white" opacity="0.95" />
    <circle cx="20" cy="28" r="3.5" fill="white" opacity="0.95" />
    <circle cx="28" cy="20" r="3.5" fill="white" opacity="0.95" />
    <circle cx="20" cy="20" r="4.5" fill="white" />
    <line x1="12" y1="20" x2="15.5" y2="20" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
    <line x1="20" y1="12" x2="20" y2="15.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
    <line x1="20" y1="24.5" x2="20" y2="28" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
    <line x1="24.5" y1="20" x2="28" y2="20" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
    <circle cx="20" cy="20" r="2" fill="url(#jlg2)" />
  </svg>
);

/**
 * Public "join by link" landing page (/join/:code) - the destination behind the
 * "Copy Join Link" button on a teacher's course card. Handles all three cases:
 * not logged in, logged in as a non-student, and logged in as a student.
 */
const JoinCourse: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<CourseLookup | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    courseService.lookupByCode(code.toUpperCase())
      .then(setPreview)
      .catch(() => setNotFound(true))
      .finally(() => setLoadingPreview(false));
  }, [code]);

  const handleJoin = async () => {
    if (!code) return;
    setJoining(true);
    setError('');
    try {
      const result = await enrollmentService.join(code.toUpperCase());
      setJoined(result.course_name || preview?.name || 'the course');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to join course. The code may be invalid or expired.');
    } finally {
      setJoining(false);
    }
  };

  if (isLoading || loadingPreview) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      <div className="page-bg-decoration" />
      <div className="w-full max-w-md z-10">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <LogoMark size={38} />
          <div className="flex items-baseline gap-0.5">
            <span className="text-xl font-bold text-text-primary">Concept</span>
            <span className="text-xl font-bold" style={{ color: 'rgb(var(--primary-light))' }}>Intel</span>
          </div>
        </div>

        <div className="glass-panel rounded-2xl shadow-card overflow-hidden text-center animate-fade-up">
          <div className="h-1.5 bg-gradient-to-r from-primary via-secondary to-blue-500" />
          <div className="p-8">
          {notFound ? (
            <>
              <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
              <h1 className="text-xl font-bold text-text-primary mb-1.5">Invalid join link</h1>
              <p className="text-text-secondary text-sm">This course code doesn't exist or is no longer valid.</p>
            </>
          ) : joined ? (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
              <h1 className="text-xl font-bold text-text-primary mb-1.5">You're enrolled!</h1>
              <p className="text-text-secondary text-sm mb-6">Successfully joined {joined}.</p>
              <button onClick={() => navigate('/student')} className="btn-primary w-full justify-center">
                Go to Dashboard
              </button>
            </>
          ) : !token || !user ? (
            <>
              <h1 className="text-xl font-bold text-text-primary mb-1.5">Join {preview?.name}</h1>
              <p className="text-text-secondary text-sm mb-6">
                Log in as a student to join this course{preview?.code ? ` (${preview.code})` : ''}.
              </p>
              <Link
                to={`/login?redirect=${encodeURIComponent(`/join/${code}`)}`}
                className="btn-primary w-full justify-center"
              >
                <LogIn className="w-4 h-4" /> Log In to Join
              </Link>
              <p className="text-sm text-text-secondary mt-4">
                Don't have an account?{' '}
                <Link to={`/register?redirect=${encodeURIComponent(`/join/${code}`)}`} className="text-primary font-semibold hover:text-primary-hover transition-colors">
                  Register here
                </Link>
              </p>
            </>
          ) : user.role !== 'student' ? (
            <>
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h1 className="text-xl font-bold text-text-primary mb-1.5">Students only</h1>
              <p className="text-text-secondary text-sm">
                You're signed in as {user.role.replace('_', ' ')}. Only student accounts can join a course this way.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-text-primary mb-1.5">Join {preview?.name}</h1>
              <p className="text-text-secondary text-sm mb-6">
                {preview?.code ? `Course code: ${preview.code}` : 'Confirm below to enroll.'}
              </p>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 flex items-center gap-2 text-sm mb-4 text-left">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <button onClick={handleJoin} disabled={joining} className="btn-primary w-full justify-center disabled:opacity-60">
                {joining ? <><Loader2 className="w-4 h-4 animate-spin" /> Joining...</> : 'Join Course'}
              </button>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default JoinCourse;
