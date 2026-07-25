import React, { useState, useEffect } from 'react';
import { courseCoordinatorService, courseService } from '../services/api';
import { AppShell, type NavItem } from '../components/AppShell';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  Network, AlertCircle, CheckCircle2, XCircle, Pencil, X, Check,
} from 'lucide-react';

interface CourseInstance {
  id: number;
  name: string;
  code: string | null;
  semester: string;
  status: string;
  description: string | null;
  max_students: number | null;
  enrollment_start: string | null;
  enrollment_end: string | null;
  start_date: string | null;
  end_date: string | null;
  graph_status: string;
}

const graphBadgeClass = (status: string) => {
  if (status === 'Approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30';
  if (status === 'Rejected') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30';
  return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30';
};

const CourseCoordinatorDashboard: React.FC = () => {
  const [courses, setCourses] = useState<CourseInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMaxStudents, setEditMaxStudents] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchCourses = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await courseService.getAll();
      setCourses(data);
    } catch (err: any) {
      if (!silent) setError('Failed to load courses. Verify API connection.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  useAutoRefresh(() => fetchCourses(true));

  const approve = async (courseId: number) => {
    setProcessingId(courseId);
    setError('');
    try {
      await courseCoordinatorService.approveGraph(courseId);
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to approve knowledge graph.');
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (courseId: number) => {
    setProcessingId(courseId);
    setError('');
    try {
      await courseCoordinatorService.rejectGraph(courseId);
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reject knowledge graph.');
    } finally {
      setProcessingId(null);
    }
  };

  const startEdit = (course: CourseInstance) => {
    setEditingId(course.id);
    setEditStatus(course.status);
    setEditDescription(course.description || '');
    setEditMaxStudents(course.max_students ? String(course.max_students) : '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    setSavingEdit(true);
    setError('');
    try {
      await courseCoordinatorService.updateCourse(id, {
        status: editStatus,
        description: editDescription,
        max_students: editMaxStudents ? parseInt(editMaxStudents) : null,
      });
      setEditingId(null);
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update course info.');
    } finally {
      setSavingEdit(false);
    }
  };

  const navItems: NavItem[] = [
    { key: 'courses', label: 'Courses', icon: Network, active: true },
  ];

  return (
    <AppShell roleLabel="Course Coordinator Portal" logoIcon={Network} navItems={navItems}>
      <div className="space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 cursor-pointer shrink-0" onClick={() => setError('')} />
            <span>{error}</span>
          </div>
        )}

        <div>
          <h3 className="text-base font-bold text-text-primary mb-4">Courses</h3>
          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>
          ) : courses.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">No courses created yet.</div>
          ) : (
            <div className="space-y-3">
              {courses.map((course) => {
                const isEditing = editingId === course.id;
                return (
                  <div key={course.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card">
                    <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                      <div>
                        <p className="font-bold text-text-primary">{course.name} <span className="text-text-muted font-normal">({course.code})</span></p>
                        <p className="text-xs text-text-muted mt-0.5">{course.semester} &middot; {course.status}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${graphBadgeClass(course.graph_status)}`}>
                          Graph: {course.graph_status}
                        </span>
                        <button
                          onClick={() => approve(course.id)}
                          disabled={processingId === course.id || course.graph_status === 'Approved'}
                          className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => reject(course.id)}
                          disabled={processingId === course.id || course.graph_status === 'Rejected'}
                          className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/30 dark:hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                        {!isEditing && (
                          <button onClick={() => startEdit(course)} className="btn-ghost text-xs px-3 py-1.5">
                            <Pencil className="w-3.5 h-3.5" /> Edit Info
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start border-t border-border pt-4">
                        <div>
                          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Status</label>
                          <select className="input-light text-sm" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                            <option value="Draft">Draft</option>
                            <option value="Open">Open</option>
                            <option value="Closed">Closed</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description</label>
                          <input
                            className="input-light text-sm" value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            maxLength={100}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Max Students</label>
                          <input
                            type="number" min="1" className="input-light text-sm" placeholder="No limit"
                            value={editMaxStudents} onChange={(e) => setEditMaxStudents(e.target.value)}
                          />
                        </div>
                        <div className="flex items-center gap-2 sm:col-span-4">
                          <button onClick={() => saveEdit(course.id)} disabled={savingEdit} className="btn-primary text-xs px-3 py-2">
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button onClick={cancelEdit} className="btn-ghost text-xs px-3 py-2">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default CourseCoordinatorDashboard;
