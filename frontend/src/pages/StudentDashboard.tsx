import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { enrollmentService } from '../services/api';
import EnrollmentCodeForm from '../components/EnrollmentCodeForm';
import { AppShell, type NavItem } from '../components/AppShell';
import { ToDoList } from '../components/ToDoList';
import { TodayTeachingWidget } from '../components/TodayTeachingWidget';
import { EmptyStateIllustration } from '../components/illustrations';
import { getCourseBannerClass } from '../lib/courseTheme';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  GraduationCap, BookOpen, User, Hash, ArrowRight,
  Star, CheckCircle, AlertCircle, Plus,
  TrendingUp, Award, BarChart3, ChevronRight, ListChecks, LayoutGrid
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
    theme_color?: string | null;
  };
}

const StudentDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [enrollments, setEnrollments] = useState<EnrollmentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  // Arriving from another page's sidebar (see lib/roleNav.ts) passes which tab
  // to land on via router state, so the sidebar's "My Classes"/"To-Do" links
  // work the same from anywhere, not just from this dashboard itself.
  const [activeTab, setActiveTab] = useState<'classes' | 'todo'>(
    (location.state as { tab?: 'classes' | 'todo' } | null)?.tab || 'classes'
  );

  const fetchEnrollments = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await enrollmentService.getMyCourses();
      setEnrollments(data);
    } catch (err: any) {
      if (!silent) setError('Failed to fetch enrollment roster.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnrollments();
  }, []);

  useAutoRefresh(() => fetchEnrollments(true));

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
    if (progress >= 70) return 'text-emerald-600 dark:text-emerald-400';
    if (progress >= 40) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-500 dark:text-rose-400';
  };

  // Per-course rows are NOT listed here - AppShell already fetches this
  // student's enrollments itself and splices them in right after "My Classes"
  // (see AppShell.tsx's own myCourses/expandedNavItems), specifically so pages
  // like this one don't each have to load and render the course list
  // themselves. Doing it here too used to duplicate every course in the
  // sidebar - one row from this list, one row from AppShell's own splice.
  const navItems: NavItem[] = [
    {
      key: 'classes',
      label: 'My Classes',
      icon: LayoutGrid,
      active: activeTab === 'classes',
      onClick: () => setActiveTab('classes'),
    },
    {
      key: 'todo',
      label: 'To-Do',
      icon: ListChecks,
      active: activeTab === 'todo',
      onClick: () => setActiveTab('todo'),
    },
  ];

  return (
    <AppShell
      roleLabel="Student Hub"
      logoIcon={GraduationCap}
      navItems={navItems}
      headerActions={
        <button
          onClick={() => setShowJoinModal(true)}
          id="join-class-btn"
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Join a class
        </button>
      }
    >
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

        {/* Welcome Banner + Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          {/* Welcome Card */}
          <div className="lg:col-span-2 glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-muted font-medium">Welcome back,</p>
                <h2 className="text-2xl font-extrabold text-text-primary flex items-center gap-2 mt-0.5">
                  {user?.full_name} <Star className="w-5 h-5 text-amber-400" />
                </h2>
                <p className="text-text-secondary text-sm mt-2 leading-relaxed">
                  Track conceptual milestones, explore concept graphs, and build your learning path.
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
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-center gap-3 mb-6 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-primary-muted border border-primary/20 text-primary rounded-xl p-4 flex items-center gap-3 mb-6 text-sm animate-fade-in">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {activeTab === 'todo' && <ToDoList />}

        {activeTab === 'classes' && !loading && enrollments.length > 0 && (
          <TodayTeachingWidget
            role="student"
            courses={enrollments.map((e) => ({ id: e.course.id, name: e.course.name }))}
          />
        )}

        {/* Courses Grid */}
        {activeTab === 'classes' && (loading ? (
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
            <EmptyStateIllustration className="w-32 h-32 mx-auto mb-4" />
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
                  className="group glass-panel-interactive rounded-2xl overflow-hidden border border-border/40 animate-fade-up transition-all cursor-pointer"
                  style={{ animationDelay: `${i * 0.05}s` }}
                  onClick={() => navigate(`/course/${enr.course.id}`)}
                >
                  {/* Classroom-style banner */}
                  <div className={`relative h-24 px-5 pt-4 pb-8 bg-gradient-to-br ${getCourseBannerClass(enr.course)}`}>
                    <div className="flex items-center justify-between">
                      <span className="bg-white/20 backdrop-blur-sm text-white text-[12px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                        <Hash className="w-3 h-3" />
                        {enr.course.code || 'NO-CODE'}
                      </span>
                      <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${
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
        ))}
    </AppShell>
  );
};

export default StudentDashboard;
