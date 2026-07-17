import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { enrollmentService } from '../services/api';
import EnrollmentCodeForm from '../components/EnrollmentCodeForm';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import {
  GraduationCap, LogOut, BookOpen, User, Hash, ArrowRight,
  Sparkles, CheckCircle, AlertCircle, Plus,
  TrendingUp, Award, BarChart3, ChevronRight, KeyRound
} from 'lucide-react';

interface EnrollmentDetail {
  id: number;
  status: string;
  enrolled_at: string;
  progress: number;
  course: {
    id: number;
    name: string;
    code: string;
    semester: string;
    status: string;
  };
}

// Classroom-style banner palette — cycles through the app's existing brand
// colors plus a few standard Tailwind accents, picked by course id so each
// card keeps a stable color across renders.
const BANNER_GRADIENTS = [
  'from-primary to-primary-hover',
  'from-secondary to-secondary-hover',
  'from-rose-500 to-rose-600',
  'from-amber-500 to-amber-600',
  'from-emerald-600 to-emerald-700',
];
const getBannerGradient = (id: number) => BANNER_GRADIENTS[Math.abs(id) % BANNER_GRADIENTS.length];

const StudentDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showChangePassword, setShowChangePassword] = useState(false);

  const [enrollments, setEnrollments] = useState<EnrollmentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      const data = await enrollmentService.getMyCourses();
      setEnrollments(data);
    } catch (err: any) {
      setError('Failed to fetch enrollment roster.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnrollments();
  }, []);

  const handleEnrolled = (message: string) => {
    setError('');
    setSuccess(message);
    setShowJoinModal(false);
    fetchEnrollments();
  };

  // Compute overall average progress
  const avgProgress = enrollments.length
    ? Math.round(enrollments.reduce((sum, e) => sum + e.progress, 0) / enrollments.length)
    : 0;

  const getDifficultyColor = (progress: number) => {
    if (progress >= 70) return 'text-emerald-600';
    if (progress >= 40) return 'text-amber-600';
    return 'text-rose-500';
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="page-bg-decoration" />

      {/* Header */}
      <header className="glass-panel sticky top-0 z-30 border-b border-border shadow-soft">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold gradient-text leading-tight">ConceptIntel</h1>
              <p className="text-[10px] text-text-muted">Student Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowJoinModal(true)}
              id="join-class-btn"
              title="Join a class"
              className="w-9 h-9 flex items-center justify-center bg-gradient-to-tr from-secondary to-secondary-hover text-white rounded-full shadow-soft active:scale-95 transition-all"
            >
              <Plus className="w-4.5 h-4.5" />
            </button>
            <div className="flex items-center gap-2 bg-primary-muted border border-primary/20 rounded-lg px-3 py-1.5 text-sm">
              <User className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-primary text-xs">{user?.full_name}</span>
            </div>
            <button
              onClick={() => setShowChangePassword(true)}
              className="p-2 text-text-muted hover:text-primary rounded-lg hover:bg-primary-muted border border-transparent hover:border-primary/20 transition-all"
              title="Change Password"
            >
              <KeyRound className="w-4 h-4" />
            </button>
            <button
              onClick={logout}
              id="student-logout"
              className="p-2 text-text-muted hover:text-rose-500 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Join a Class Modal */}
      {showJoinModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setShowJoinModal(false)}
        >
          <div className="w-full max-w-md animate-fade-up">
            <EnrollmentCodeForm onEnrolled={handleEnrolled} onClose={() => setShowJoinModal(false)} />
          </div>
        </div>
      )}

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 relative z-10 flex flex-col lg:flex-row gap-6 items-start">

        {/* Sidebar — enrolled classes only */}
        <aside className="w-full lg:w-64 shrink-0 bg-surface rounded-2xl border border-border shadow-card overflow-hidden animate-fade-up lg:sticky lg:top-24">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Enrolled Classes</h3>
          </div>
          {enrollments.length === 0 ? (
            <p className="text-xs text-text-muted px-4 py-4">No classes joined yet.</p>
          ) : (
            <nav className="py-2 max-h-[70vh] overflow-y-auto">
              {enrollments.map((enr) => (
                <button
                  key={enr.id}
                  id={`sidebar-course-${enr.course.id}`}
                  onClick={() => navigate(`/course/${enr.course.id}`)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-background transition-all"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 bg-gradient-to-br ${getBannerGradient(enr.course.id)}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-primary truncate">{enr.course.name}</span>
                    <span className="block text-[11px] text-text-muted truncate">{enr.course.code || 'NO-CODE'}</span>
                  </span>
                </button>
              ))}
            </nav>
          )}
        </aside>

        <main className="flex-1 min-w-0">

        {/* Welcome Banner + Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          {/* Welcome Card */}
          <div className="lg:col-span-2 glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-muted font-medium">Welcome back,</p>
                <h2 className="text-2xl font-extrabold text-text-primary flex items-center gap-2 mt-0.5">
                  {user?.full_name} <Sparkles className="w-5 h-5 text-amber-400" />
                </h2>
                <p className="text-text-secondary text-sm mt-2 leading-relaxed">
                  Track conceptual milestones, explore knowledge graphs, and build your learning path.
                </p>
              </div>
              <div className="w-14 h-14 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-2xl flex items-center justify-center shrink-0">
                <BookOpen className="w-7 h-7 text-primary" />
              </div>
            </div>
          </div>

          {/* Overall Mastery */}
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up" style={{ animationDelay: '0.05s' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="stat-icon-bg bg-primary-muted">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Overall Mastery</p>
                <p className="text-2xl font-extrabold text-text-primary">{avgProgress}%</p>
              </div>
            </div>
            <div className="progress-bar-track h-2">
              <div className="progress-bar-fill h-2" style={{ width: `${avgProgress}%` }} />
            </div>
            <p className="text-xs text-text-muted mt-2">Across {enrollments.length} course{enrollments.length !== 1 ? 's' : ''}</p>
          </div>

          {/* Enrolled Courses count */}
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center gap-3 mb-1">
              <div className="stat-icon-bg bg-secondary-muted">
                <Award className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Enrolled</p>
                <p className="text-2xl font-extrabold text-text-primary">{enrollments.length}</p>
              </div>
            </div>
            <p className="text-xs text-text-muted mt-1">Active classrooms</p>
          </div>
        </div>

        {/* Alert Banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 flex items-center gap-3 mb-6 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 flex items-center gap-3 mb-6 text-sm animate-fade-in">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Courses Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-panel rounded-2xl p-6 h-52 border border-border">
                <div className="shimmer-loader h-4 rounded-lg w-1/3 mb-4" />
                <div className="shimmer-loader h-6 rounded-lg w-3/4 mb-3" />
                <div className="shimmer-loader h-3 rounded-lg w-1/2 mb-6" />
                <div className="shimmer-loader h-2 rounded-full" />
              </div>
            ))}
          </div>
        ) : enrollments.length === 0 ? (
          <div className="text-center max-w-md mx-auto mt-16 animate-fade-up">
            <BookOpen className="w-16 h-16 text-primary/30 mx-auto mb-4" strokeWidth={1.25} />
            <h3 className="text-lg font-bold text-text-primary mb-1.5">No classes yet</h3>
            <p className="text-text-secondary mb-4 text-sm">
              You haven't joined any classrooms. Tap the <strong>+</strong> button above to enter an enrollment code from your teacher.
            </p>
            <button
              onClick={() => setShowJoinModal(true)}
              className="inline-flex items-center gap-1.5 text-sm text-secondary font-semibold hover:text-secondary-hover transition-all"
            >
              <ChevronRight className="w-4 h-4" /> Join a class
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Your Enrolled Classrooms
              </h3>
              <span className="text-xs text-text-muted">{enrollments.length} course{enrollments.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {enrollments.map((enr, i) => (
                <div
                  key={enr.id}
                  className="group rounded-2xl overflow-hidden border border-border shadow-card bg-surface animate-fade-up hover:shadow-hover hover:-translate-y-0.5 transition-all cursor-pointer"
                  style={{ animationDelay: `${i * 0.05}s` }}
                  onClick={() => navigate(`/course/${enr.course.id}`)}
                >
                  {/* Classroom-style banner */}
                  <div className={`relative h-24 px-5 pt-4 pb-8 bg-gradient-to-br ${getBannerGradient(enr.course.id)}`}>
                    <div className="flex items-center justify-between">
                      <span className="bg-white/20 backdrop-blur-sm text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                        <Hash className="w-3 h-3" />
                        {enr.course.code || 'NO-CODE'}
                      </span>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                        enr.course.status.toLowerCase() === 'open'
                          ? 'bg-white/90 text-emerald-700'
                          : 'bg-white/90 text-amber-700'
                      }`}>
                        {enr.course.status}
                      </span>
                    </div>
                    <h4 className="text-white font-bold text-lg leading-snug line-clamp-1 mt-2 drop-shadow-sm">
                      {enr.course.name}
                    </h4>
                    <p className="text-white/80 text-xs mt-0.5">{enr.course.semester}</p>

                    {/* Overlapping avatar */}
                    <div className="absolute -bottom-5 right-4 w-11 h-11 rounded-full bg-surface p-0.5 shadow-md">
                      <div className="w-full h-full rounded-full bg-primary-muted flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                    </div>
                  </div>

                  {/* Body — lean, quick-glance only */}
                  <div className="pt-7 px-5 pb-5">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-text-muted font-medium">Concept Mastery</span>
                      <span className={`font-bold ${getDifficultyColor(enr.progress)}`}>
                        {enr.progress.toFixed(0)}%
                      </span>
                    </div>
                    <div className="progress-bar-track h-2">
                      <div className="progress-bar-fill h-2" style={{ width: `${enr.progress}%` }} />
                    </div>

                    <div className="flex items-center justify-end border-t border-border mt-4 pt-3.5">
                      <button
                        id={`enter-course-${enr.course.id}`}
                        onClick={(e) => { e.stopPropagation(); navigate(`/course/${enr.course.id}`); }}
                        className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary-hover transition-all"
                      >
                        <span>Enter Class</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </main>
      </div>
    </div>
  );
};

export default StudentDashboard;
