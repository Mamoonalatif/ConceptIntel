import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { courseService } from '../services/api';
import {
  Plus, LogOut, BookOpen, User, Hash, Users, ArrowRight, ShieldCheck,
  Sparkles, RefreshCw, X, HelpCircle, BarChart3, Network, GraduationCap, FileText
} from 'lucide-react';

interface Course {
  id: number;
  name: string;
  code: string;
  semester: string;
  enrollment_code: string;
  max_students: number | null;
  status: string;
  prerequisite_course_id: number | null;
  catalog_id: number | null;
  description: string | null;
  enrollment_start: string | null;
  enrollment_end: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface CatalogEntry {
  id: number;
  name: string;
  code: string;
  prerequisite_catalog_id: number | null;
}

const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 100;

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

const TeacherDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [courses, setCourses] = useState<Course[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [catalogId, setCatalogId] = useState<string>('');
  const [semester, setSemester] = useState('Semester 2');
  const [description, setDescription] = useState('');
  const [enrollmentStart, setEnrollmentStart] = useState('');
  const [enrollmentEnd, setEnrollmentEnd] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxStudents, setMaxStudents] = useState<string>('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const data = await courseService.getTeacherCourses();
      setCourses(data);
    } catch (err: any) {
      setError('Failed to fetch courses. Verify API connection.');
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    try {
      const data = await courseService.getCatalog();
      setCatalog(data);
    } catch (err: any) {
      setError('Failed to fetch course catalog. Verify API connection.');
    }
  };

  useEffect(() => {
    fetchCourses();
    fetchCatalog();
  }, []);

  const resetForm = () => {
    setCatalogId('');
    setSemester('Semester 2');
    setDescription('');
    setEnrollmentStart('');
    setEnrollmentEnd('');
    setStartDate('');
    setEndDate('');
    setMaxStudents('');
    setFormError('');
  };

  const selectedCatalogEntry = catalog.find(c => c.id === parseInt(catalogId));
  const prerequisiteEntry = selectedCatalogEntry?.prerequisite_catalog_id
    ? catalog.find(c => c.id === selectedCatalogEntry.prerequisite_catalog_id)
    : null;

  const validateForm = (): string | null => {
    if (!catalogId) return 'Please select a course from the catalog.';
    if (!enrollmentStart || !enrollmentEnd || !startDate || !endDate) return 'All dates are required.';
    if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
      return `Description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`;
    }
    if (enrollmentStart >= enrollmentEnd) return 'Enrollment start must be before enrollment end.';
    if (enrollmentEnd > startDate) return 'Enrollment end must be before or equal to the course start date.';
    const today = new Date().toISOString().slice(0, 10);
    if (startDate < today) return 'Course start date must not be in the past.';
    if (endDate <= startDate) return 'Course end date must be after the start date.';
    return null;
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFormError('');

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      await courseService.create({
        catalog_id: parseInt(catalogId),
        semester,
        description,
        enrollment_start: enrollmentStart,
        enrollment_end: enrollmentEnd,
        start_date: startDate,
        end_date: endDate,
        max_students: maxStudents ? parseInt(maxStudents) : undefined,
      });
      resetForm();
      setShowModal(false);
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create course');
    } finally {
      setSubmitting(false);
    }
  };

  const totalOpen = courses.filter(c => c.status.toLowerCase() === 'open').length;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="page-bg-decoration" />

      {/* Header */}
      <header className="glass-panel sticky top-0 z-30 border-b border-border shadow-soft">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold gradient-text leading-tight">ConceptIntel</h1>
              <p className="text-[10px] text-text-muted">Teacher Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-primary-muted border border-primary/20 rounded-lg px-3 py-1.5">
              <User className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-primary text-xs">{user?.full_name}</span>
            </div>
            <button
              id="create-course-btn"
              onClick={() => setShowModal(true)}
              className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary text-white flex items-center justify-center shadow-glow hover:shadow-hover hover:scale-105 active:scale-95 transition-all"
              title="Create a new class"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={logout}
              id="teacher-logout"
              className="p-2 text-text-muted hover:text-rose-500 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 relative z-10">

        {/* Welcome + Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          {/* Welcome */}
          <div className="lg:col-span-2 glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-text-muted font-medium">Welcome back,</p>
              <h2 className="text-2xl font-extrabold text-text-primary flex items-center gap-2 mt-0.5">
                {user?.full_name} <Sparkles className="w-5 h-5 text-amber-400" />
              </h2>
              <p className="text-text-secondary text-sm mt-2">
                Manage courses, build knowledge graphs, and track student progress.
              </p>
            </div>
          </div>

          {/* Stat: Total Courses */}
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up" style={{ animationDelay: '0.05s' }}>
            <div className="flex items-center gap-3 mb-1">
              <div className="stat-icon-bg bg-primary-muted">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Courses</p>
                <p className="text-2xl font-extrabold text-text-primary">{courses.length}</p>
              </div>
            </div>
            <p className="text-xs text-text-muted">{totalOpen} active / open</p>
          </div>

          {/* Stat: Graphs Built */}
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center gap-3 mb-1">
              <div className="stat-icon-bg bg-secondary-muted">
                <Network className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Knowledge Graphs</p>
                <p className="text-2xl font-extrabold text-text-primary">{courses.length}</p>
              </div>
            </div>
            <p className="text-xs text-text-muted">One per course</p>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 flex items-center gap-3 mb-6 text-sm animate-fade-in">
            <X className="w-5 h-5 cursor-pointer shrink-0" onClick={() => setError('')} />
            <span>{error}</span>
          </div>
        )}

        {/* Courses Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-panel rounded-2xl p-6 h-64 border border-border">
                <div className="flex justify-between mb-4">
                  <div className="shimmer-loader h-6 w-20 rounded-lg" />
                  <div className="shimmer-loader h-5 w-14 rounded-full" />
                </div>
                <div className="shimmer-loader h-6 rounded-lg w-3/4 mb-3" />
                <div className="shimmer-loader h-4 rounded-lg w-1/2 mb-2" />
                <div className="shimmer-loader h-4 rounded-lg w-2/3" />
              </div>
            ))}
          </div>
        ) : courses.length === 0 ? (
          <div className="text-center max-w-md mx-auto mt-16 animate-fade-up">
            <BookOpen className="w-16 h-16 text-primary/30 mx-auto mb-4" strokeWidth={1.25} />
            <h3 className="text-lg font-bold text-text-primary mb-1.5">No classes yet</h3>
            <p className="text-text-secondary mb-6 text-sm">
              Create your first class to start uploading materials and inviting students.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Create Class
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-primary" />
                Your Courses
              </h3>
              <span className="text-xs text-text-muted">{courses.length} total</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map((course, i) => {
                const prereqCourse = courses.find(c => c.id === course.prerequisite_course_id);
                return (
                  <div
                    key={course.id}
                    id={`course-card-${course.id}`}
                    className="group rounded-2xl overflow-hidden border border-border shadow-card bg-surface animate-fade-up hover:shadow-hover hover:-translate-y-0.5 transition-all cursor-pointer"
                    style={{ animationDelay: `${i * 0.05}s` }}
                    onClick={() => navigate(`/course/${course.id}`)}
                  >
                    {/* Classroom-style banner */}
                    <div className={`relative h-28 px-5 pt-4 pb-8 bg-gradient-to-br ${getBannerGradient(course.id)}`}>
                      <div className="flex items-center justify-between">
                        <span className="bg-white/20 backdrop-blur-sm text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {course.code || 'NO-CODE'}
                        </span>
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                          course.status.toLowerCase() === 'open'
                            ? 'bg-white/90 text-emerald-700'
                            : 'bg-white/90 text-amber-700'
                        }`}>
                          {course.status}
                        </span>
                      </div>
                      <h3 className="text-white font-bold text-lg leading-snug line-clamp-2 mt-2 drop-shadow-sm">
                        {course.name}
                      </h3>
                      <p className="text-white/80 text-xs mt-0.5">{course.semester}</p>

                      {/* Overlapping avatar */}
                      <div className="absolute -bottom-5 right-4 w-11 h-11 rounded-full bg-surface p-0.5 shadow-md">
                        <div className="w-full h-full rounded-full bg-primary-muted flex items-center justify-center">
                          <GraduationCap className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                    </div>

                    {/* Body — lean, quick-glance only */}
                    <div className="pt-7 px-5 pb-5">
                      <div className="flex items-center gap-4 text-xs text-text-secondary mb-4">
                        <span className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-text-muted" />
                          {course.max_students ? `Max ${course.max_students}` : 'No limit'}
                        </span>
                        {prereqCourse && (
                          <span className="flex items-center gap-1.5 truncate">
                            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="text-primary font-medium truncate">{prereqCourse.name}</span>
                          </span>
                        )}
                      </div>

                      <div className="border-t border-border pt-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Join Code</p>
                          <p className="text-sm font-mono font-extrabold text-text-primary tracking-widest bg-background border border-border px-2 py-0.5 rounded-lg mt-0.5 select-all">
                            {course.enrollment_code}
                          </p>
                        </div>
                        <button
                          id={`manage-course-${course.id}`}
                          onClick={(e) => { e.stopPropagation(); navigate(`/course/${course.id}`); }}
                          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary-hover transition-all"
                        >
                          <span>Manage</span>
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Create Course Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="w-full max-w-lg bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-primary-muted rounded-lg flex items-center justify-center">
                  <Plus className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-base font-bold text-text-primary">Create New Course</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-background transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCourse} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5">Course *</label>
                <select
                  required
                  className="input-light"
                  value={catalogId}
                  onChange={(e) => setCatalogId(e.target.value)}
                >
                  <option value="">Select a predefined course...</option>
                  {catalog.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>

              {selectedCatalogEntry && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-text-secondary mb-1.5">Course Code</label>
                    <input type="text" disabled className="input-light bg-background text-text-muted" value={selectedCatalogEntry.code} readOnly />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-text-secondary mb-1.5 flex items-center gap-1">
                      Prerequisite <HelpCircle className="w-3.5 h-3.5 text-text-muted" />
                    </label>
                    <p className="input-light bg-background text-text-muted flex items-center">
                      {prerequisiteEntry ? `Prerequisite: ${prerequisiteEntry.name}` : 'No prerequisite'}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5">Semester *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Semester 2"
                  className="input-light"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Description *</span>
                  <span className={`text-xs font-normal ${description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX ? 'text-rose-500' : 'text-emerald-600'}`}>
                    {description.length}/{DESCRIPTION_MAX}
                  </span>
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="Briefly describe this course (20-100 characters)"
                  className="input-light resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5">Enrollment Start *</label>
                  <input
                    type="date"
                    required
                    className="input-light"
                    value={enrollmentStart}
                    onChange={(e) => setEnrollmentStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5">Enrollment End *</label>
                  <input
                    type="date"
                    required
                    className="input-light"
                    value={enrollmentEnd}
                    onChange={(e) => setEnrollmentEnd(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5">Course Start *</label>
                  <input
                    type="date"
                    required
                    className="input-light"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1.5">Course End *</label>
                  <input
                    type="date"
                    required
                    className="input-light"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5">Max Capacity (optional)</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  placeholder="No limit"
                  className="input-light"
                  value={maxStudents}
                  onChange={(e) => setMaxStudents(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button type="button" onClick={() => setShowModal(false)} className="btn-ghost">Cancel</button>
                <button
                  type="submit"
                  id="create-course-submit"
                  disabled={submitting}
                  className="btn-primary disabled:opacity-60"
                >
                  {submitting ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Creating...</>
                  ) : (
                    <><Plus className="w-4 h-4" /> Create Course</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
