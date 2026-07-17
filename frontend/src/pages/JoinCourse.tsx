import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { courseService, enrollmentService, type CourseLookup } from '../services/api';
import { Brain, CheckCircle2, AlertCircle, Loader2, LogIn } from 'lucide-react';

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
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-card">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold gradient-text">ConceptIntel</span>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-card text-center">
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
  );
};

export default JoinCourse;
