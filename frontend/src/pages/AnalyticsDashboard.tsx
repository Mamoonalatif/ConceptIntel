import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell, type NavItem } from '../components/AppShell';
import { courseService, analyticsService, type CourseAnalytics, type MyCourseProgress, type PlatformOverview } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { getPrimaryNavItems } from '../lib/roleNav';
import {
  BarChart3, TrendingUp, AlertTriangle, Users, Flame, RefreshCw, Info,
  GraduationCap, ShieldCheck, Network, BookOpen,
} from 'lucide-react';
import { EmptyStateIllustration } from '../components/illustrations';
import { FoxSpinner } from '../components/FoxSpinner';

// One consistent color per role slice, reused across the donut and its legend.
const ROLE_SLICE_COLORS: Record<string, string> = {
  students: '#2563eb', teachers: '#0d9488', program_coordinators: '#f59e0b',
  course_coordinators: '#e11d48', admins: '#7c3aed',
};
const ROLE_SLICE_LABELS: Record<string, string> = {
  students: 'Students', teachers: 'Teachers', program_coordinators: 'Program Coordinators',
  course_coordinators: 'Course Coordinators', admins: 'Admins',
};

interface CourseOption {
  id: number;
  name: string;
}

/* Status severity color — reserved rose/amber/teal, consistent with the
   bottleneck panel below (never used for arbitrary "series" identity). */
const rateBarClass = (value: number) => (value < 50 ? 'bg-rose-500' : value < 75 ? 'bg-amber-500' : 'bg-teal-500');

const AnalyticsDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin';

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [data, setData] = useState<CourseAnalytics | null>(null);
  const [myProgress, setMyProgress] = useState<MyCourseProgress[] | null>(null);
  const [platform, setPlatform] = useState<PlatformOverview | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Admin gets a platform-wide overview (every course/student aggregated) in
  // addition to the per-course drill-down below - a different, higher-level
  // question than "how is this one course doing."
  useEffect(() => {
    if (!isAdmin) return;
    analyticsService.getPlatformOverview()
      .then(setPlatform)
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load platform analytics.')))
      .finally(() => setPlatformLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Load the picker's course list (teachers see their own; oversight roles see
  // everything, matching how the admin/coordinator scope pickers elsewhere in
  // the app already work) — or the student's own enrolled courses.
  useEffect(() => {
    (async () => {
      try {
        if (isStudent) {
          const progress = await analyticsService.getMyProgress();
          setMyProgress(progress);
        } else {
          const list = user?.role === 'teacher'
            ? await courseService.getTeacherCourses()
            : await courseService.getAll();
          const opts: CourseOption[] = list.map((c: any) => ({ id: c.id, name: c.code ? `${c.name} (${c.code})` : c.name }));
          setCourses(opts);
          if (opts.length) setCourseId(opts[0].id);
        }
      } catch (err: any) {
        setError(apiErrorMessage(err, 'Failed to load analytics.'));
      } finally {
        if (isStudent) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected course's analytics whenever the picker changes.
  useEffect(() => {
    if (isStudent || courseId === null) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const result = await analyticsService.getCourseAnalytics(courseId);
        setData(result);
      } catch (err: any) {
        setData(null);
        setError(apiErrorMessage(err, 'Failed to load analytics for this course.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, isStudent]);

  // Same role-specific top section as the user's own dashboard, so the sidebar
  // looks identical everywhere instead of collapsing to just the global links.
  const navItems: NavItem[] = getPrimaryNavItems(user, navigate);

  const bottlenecks = data
    ? [...data.assignments].sort((a, b) => (a.submitted_count / (a.total_students || 1)) - (b.submitted_count / (b.total_students || 1)))
    : [];

  return (
    <AppShell roleLabel="Analytics" navItems={navItems}>
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary" /> Analytics Dashboard
            </h1>
            <p className="text-text-secondary mt-1 text-sm">
              Assignment completion, grading and concept-graph stats — computed live from real course data.
            </p>
          </div>
          {!isStudent && data && data.concept_mastery.length === 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-primary-muted text-primary border border-primary/20">
              <Info className="w-3.5 h-3.5" /> No graded quizzes/assignments yet — the concept mastery heatmap will appear once students have results
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {isAdmin && (
          /* ── Admin view: platform-wide, not scoped to one course. ── */
          <div className="space-y-6">
            {platformLoading ? (
              <div className="glass-panel rounded-2xl p-10 border border-border shadow-card text-center text-sm text-text-muted">
                <FoxSpinner className="w-10 h-10 mx-auto" label="Loading platform analytics..." />
              </div>
            ) : platform ? (
              <>
                <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                  <ShieldCheck className="w-4.5 h-4.5 text-primary" /> Platform Overview
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Courses', value: platform.total_courses, icon: BookOpen, color: 'text-primary', bg: 'bg-primary-muted' },
                    { label: 'Programs', value: platform.total_programs, icon: Network, color: 'text-secondary', bg: 'bg-secondary-muted' },
                    { label: 'Students', value: platform.roles.students, icon: GraduationCap, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                    { label: 'Avg Completion', value: `${platform.avg_completion_rate}%`, icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
                  ].map(({ label, value, icon: Icon, color, bg }) => (
                    <div key={label} className="glass-panel rounded-2xl p-4 border border-border shadow-card flex items-center gap-3">
                      <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center shrink-0`}>
                        <Icon className={`w-5 h-5 ${color}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-text-muted">{label}</p>
                        <p className="text-lg font-bold text-text-primary">{value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Donut chart - role distribution, a genuinely different visual
                      format from the bar charts used everywhere else on this page. */}
                  <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                    <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" /> User Roles Platform-Wide
                    </h3>
                    {(() => {
                      const entries = Object.entries(platform.roles).filter(([, v]) => v > 0);
                      const total = entries.reduce((sum, [, v]) => sum + v, 0);
                      if (total === 0) return <p className="text-sm text-text-secondary">No users yet.</p>;
                      let acc = 0;
                      const stops = entries.map(([key, v]) => {
                        const start = (acc / total) * 360;
                        acc += v;
                        const end = (acc / total) * 360;
                        return `${ROLE_SLICE_COLORS[key]} ${start}deg ${end}deg`;
                      }).join(', ');
                      return (
                        <div className="flex items-center gap-6 flex-wrap">
                          <div
                            className="w-32 h-32 rounded-full shrink-0"
                            style={{ background: `conic-gradient(${stops})` }}
                          >
                            <div className="w-full h-full rounded-full flex items-center justify-center">
                              <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center text-sm font-bold text-text-primary">
                                {total}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {entries.map(([key, v]) => (
                              <div key={key} className="flex items-center gap-2 text-xs">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ROLE_SLICE_COLORS[key] }} />
                                <span className="text-text-secondary">{ROLE_SLICE_LABELS[key]}</span>
                                <span className="font-bold text-text-primary">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Per-course roll-up */}
                  <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                    <h3 className="text-base font-bold text-text-primary mb-1 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-primary" /> Completion by Course
                    </h3>
                    <p className="text-xs text-text-secondary mb-4">Average assignment completion rate, all students in each course.</p>
                    {platform.courses.length === 0 ? (
                      <p className="text-sm text-text-secondary">No courses yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {platform.courses.map((c) => (
                          <div key={c.course_id}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-semibold text-text-primary truncate">{c.course_name}</span>
                              <span className="font-bold text-text-muted shrink-0">
                                {c.avg_completion_rate}% · {c.student_count} student{c.student_count === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className="h-2.5 rounded-full bg-border overflow-hidden">
                              <div className={`h-full rounded-full ${rateBarClass(c.avg_completion_rate)}`} style={{ width: `${c.avg_completion_rate}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {platform.concept_mastery.length > 0 && (
                  <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                    <h3 className="text-base font-bold text-text-primary mb-1">Weakest Concepts Platform-Wide</h3>
                    <p className="text-xs text-text-secondary mb-4">Lowest average mastery across every course, real bottlenecks worth flagging to the relevant teacher.</p>
                    <div className="space-y-3">
                      {platform.concept_mastery.map((c) => (
                        <div key={c.concept_node_id}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="font-semibold text-text-primary flex items-center gap-2">
                              {c.concept_name}
                              {c.at_risk_count > 0 && (
                                <span className="text-[11px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-full px-1.5 py-0.5">
                                  {c.at_risk_count} at risk
                                </span>
                              )}
                            </span>
                            <span className={`font-bold ${c.avg_mastery < 50 ? 'text-rose-500' : c.avg_mastery < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-text-muted'}`}>
                              {Math.round(c.avg_mastery)}/100
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-border overflow-hidden">
                            <div className={`h-full rounded-full ${rateBarClass(c.avg_mastery)}`} style={{ width: `${c.avg_mastery}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t border-border pt-1">
                  <p className="text-xs text-text-muted mb-3">Drill into one course for its full per-student/per-assignment breakdown:</p>
                </div>
              </>
            ) : null}
          </div>
        )}

        {isStudent ? (
          /* ── Student view: their own real completion rate per course. ── */
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
            <h2 className="text-base font-bold text-text-primary mb-4">Your Assignment Completion</h2>
            {loading ? (
              <p className="text-sm text-text-muted flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</p>
            ) : !myProgress || myProgress.length === 0 ? (
              <p className="text-sm text-text-secondary">You're not enrolled in any courses yet.</p>
            ) : (
              <div className="space-y-4">
                {myProgress.map(p => (
                  <div key={p.course_id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-text-primary">{p.course_name}</span>
                      <span className="text-text-muted font-bold">
                        {p.submitted_count}/{p.total_assignments} submitted
                        {p.avg_grade !== null && ` · avg grade ${p.avg_grade}`}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-border overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${p.completion_rate}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {courses.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {courses.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCourseId(c.id)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                      c.id === courseId
                        ? 'bg-primary text-white border-primary shadow-glow'
                        : 'bg-surface text-text-secondary border-border hover:border-primary/30 hover:text-primary'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="glass-panel rounded-2xl p-10 border border-border shadow-card text-center text-sm text-text-muted">
                <FoxSpinner className="w-10 h-10 mx-auto" label="Loading analytics..." />
              </div>
            ) : courses.length === 0 ? (
              <div className="glass-panel rounded-2xl p-10 border border-border shadow-card text-center text-sm text-text-secondary">
                <EmptyStateIllustration className="w-24 h-24 mx-auto mb-3" />
                No courses to show analytics for yet.
              </div>
            ) : data ? (
              <>
                {/* Overview stat row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Avg Completion', value: `${data.avg_completion_rate}%`, icon: TrendingUp, color: 'text-primary', bg: 'bg-primary-muted' },
                    { label: 'Students Tracked', value: data.total_students, icon: Users, color: 'text-secondary', bg: 'bg-secondary-muted' },
                    { label: 'Concepts Mapped', value: data.concept_count, icon: BarChart3, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                    { label: 'At-Risk Students', value: data.at_risk_count, icon: AlertTriangle, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-500/10' },
                  ].map(({ label, value, icon: Icon, color, bg }) => (
                    <div key={label} className="glass-panel rounded-2xl p-4 border border-border shadow-card flex items-center gap-3">
                      <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center shrink-0`}>
                        <Icon className={`w-5 h-5 ${color}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-text-muted">{label}</p>
                        <p className="text-lg font-bold text-text-primary">{value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Concept-level mastery heatmap - real ConceptMastery data, written
                    by Assignment Evaluation grading and quiz attempts. Independent
                    of whether this course has assignments, since quizzes feed it too. */}
                {data.concept_mastery.length > 0 && (
                  <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                    <h2 className="text-base font-bold text-text-primary mb-1">Concept Mastery Heatmap</h2>
                    <p className="text-xs text-text-secondary mb-4">
                      Average mastery per concept across every student with graded evidence — weakest first. These are the course's real learning bottlenecks.
                    </p>
                    <div className="space-y-3">
                      {data.concept_mastery.map((c) => (
                        <div key={c.concept_node_id}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="font-semibold text-text-primary flex items-center gap-2">
                              {c.concept_name}
                              {c.at_risk_count > 0 && (
                                <span className="text-[11px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-full px-1.5 py-0.5">
                                  {c.at_risk_count} at risk
                                </span>
                              )}
                            </span>
                            <span className={`font-bold ${c.avg_mastery < 50 ? 'text-rose-500' : c.avg_mastery < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-text-muted'}`}>
                              {Math.round(c.avg_mastery)}/100 · {c.students_with_evidence} student{c.students_with_evidence === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-border overflow-hidden">
                            <div className={`h-full rounded-full ${rateBarClass(c.avg_mastery)}`} style={{ width: `${c.avg_mastery}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.total_assignments === 0 ? (
                  <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center text-sm text-text-secondary">
                    <EmptyStateIllustration className="w-24 h-24 mx-auto mb-3" />
                    This course has no assignments yet — completion and grading analytics will appear once assignments are posted and students submit.
                  </div>
                ) : (
                  <>
                    {/* Assignment completion heatmap */}
                    <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-bold text-text-primary">Assignment Completion by Student</h2>
                        <div className="flex items-center gap-3 text-[12px] text-text-muted">
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-100 dark:bg-rose-500/20 border border-border inline-block" /> Missing</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400 border border-border inline-block" /> Late</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-500 border border-border inline-block" /> On time</span>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-separate" style={{ borderSpacing: 4 }}>
                          <thead>
                            <tr>
                              <th className="text-left font-bold text-text-secondary px-2 py-1 sticky left-0 bg-surface">Student</th>
                              {data.assignments.map(a => (
                                <th key={a.id} className="font-semibold text-text-secondary px-2 py-1 text-center min-w-[92px]">{a.title}</th>
                              ))}
                              <th className="font-bold text-text-secondary px-2 py-1 text-center">Completion</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.students.map(s => (
                              <tr key={s.student_id}>
                                <td className="font-semibold text-text-primary px-2 py-1 whitespace-nowrap sticky left-0 bg-surface">{s.full_name}</td>
                                {data.assignments.map((a, i) => {
                                  const cellStatus = s.assignment_status[i] ?? 'missing';
                                  const cellClass = cellStatus === 'submitted'
                                    ? 'bg-teal-500 text-white'
                                    : cellStatus === 'late'
                                    ? 'bg-amber-400 text-amber-950'
                                    : 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300';
                                  const label = cellStatus === 'submitted' ? 'On time' : cellStatus === 'late' ? 'Late' : 'Missing';
                                  return (
                                    <td key={a.id} className="p-0">
                                      <div title={`${s.full_name} — ${a.title}: ${label}`} className={`rounded-lg text-center py-2 text-[11px] font-bold ${cellClass}`}>
                                        {label}
                                      </div>
                                    </td>
                                  );
                                })}
                                <td className="text-center font-bold text-text-primary px-2">{s.completion_rate}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Bottleneck identification — lowest submission rate assignments */}
                      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                        <h2 className="text-base font-bold text-text-primary mb-1 flex items-center gap-2">
                          <Flame className="w-4 h-4 text-rose-500" /> Lowest Submission Rates
                        </h2>
                        <p className="text-xs text-text-secondary mb-4">Assignments the fewest students have submitted — worth a nudge or extension.</p>
                        <div className="space-y-3">
                          {bottlenecks.map(a => {
                            const rate = a.total_students ? Math.round((a.submitted_count / a.total_students) * 100) : 0;
                            return (
                              <div key={a.id}>
                                <div className="flex items-center justify-between text-sm mb-1">
                                  <span className="font-semibold text-text-primary">{a.title}</span>
                                  <span className={`font-bold ${rate < 50 ? 'text-rose-500' : rate < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-text-muted'}`}>
                                    {a.submitted_count}/{a.total_students}
                                  </span>
                                </div>
                                <div className="h-2.5 rounded-full bg-border overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${rate < 50 ? 'bg-rose-500' : rate < 75 ? 'bg-amber-500' : 'bg-teal-500'}`}
                                    style={{ width: `${rate}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Student completion ranking */}
                      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
                        <h2 className="text-base font-bold text-text-primary mb-1 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-primary" /> Student Completion
                        </h2>
                        <p className="text-xs text-text-secondary mb-4">Assignments submitted vs. total, ranked highest to lowest.</p>
                        <div className="space-y-3">
                          {data.students.map(s => (
                            <div key={s.student_id}>
                              <div className="flex items-center justify-between text-sm mb-1">
                                <span className="font-semibold text-text-primary">{s.full_name}</span>
                                <span className="font-bold text-text-muted">
                                  {s.completion_rate}%{s.avg_grade !== null && ` · avg ${s.avg_grade}`}
                                </span>
                              </div>
                              <div className="h-2.5 rounded-full bg-border overflow-hidden">
                                <div className={`h-full rounded-full ${rateBarClass(s.completion_rate)}`} style={{ width: `${s.completion_rate}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
};

export default AnalyticsDashboard;
