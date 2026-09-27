import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { programCoordinatorService, courseService, adminService } from '../services/api';
import type { CourseCoordinatorEntry } from '../services/api';
import { AppShell, type NavItem } from '../components/AppShell';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  Layers, Plus, RefreshCw, AlertCircle, Pencil, Trash2, X, Check, UserPlus, BookOpen, Network,
} from 'lucide-react';
import { EmptyStateIllustration } from '../components/illustrations';

type ProgramCoordSection = 'catalog' | 'instances' | 'coordinators';

interface CatalogEntry {
  id: number;
  name: string;
  code: string;
  prerequisite_catalog_id: number | null;
}

interface CourseInstance {
  id: number;
  name: string;
  code: string | null;
  semester: string;
  status: string;
  teacher_id: number;
  prerequisite_course_id: number | null;
  catalog_id: number | null;
}

// Minimal shape needed for the "assign as Course Coordinator" user picker
// (from GET /auth/admin/staff - reused from AdminDashboard's staff-list pattern).
interface StaffOption {
  id: number;
  email: string;
  full_name: string;
  role: string;
}

const ProgramCoordinatorDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<ProgramCoordSection>('catalog');

  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [courses, setCourses] = useState<CourseInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // New catalog entry form
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newPrereq, setNewPrereq] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline catalog edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editPrereq, setEditPrereq] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Course Coordinator assignment section: current assignees per course, the
  // eligible-user picker options, and per-row selection/pending state.
  const [coordinatorsByCourse, setCoordinatorsByCourse] = useState<Record<number, CourseCoordinatorEntry[]>>({});
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [staffPickerError, setStaffPickerError] = useState('');
  const [selectedUserByCourse, setSelectedUserByCourse] = useState<Record<number, string>>({});
  const [assigningCourseId, setAssigningCourseId] = useState<number | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [catalogData, coursesData] = await Promise.all([
        programCoordinatorService.listCatalog(),
        courseService.getAll(),
      ]);
      setCatalog(catalogData);
      setCourses(coursesData);

      // "My courses" for coordinator-assignment purposes are derived from the
      // already-scoped catalog list: /courses/admin/catalog filters server-side
      // to this coordinator's own program(s) (or everything, for admin), so any
      // Course whose catalog_id is in that scoped list belongs to my program(s).
      // There's no dedicated "what am I scoped to" endpoint for the coordinator
      // themselves (GET /auth/admin/staff/{id}/scope is admin-only), so this
      // cross-reference is the source of truth for scope on this page.
      const myCatalogIds = new Set<number>(catalogData.map((c: CatalogEntry) => c.id));
      const myCourses = (coursesData as CourseInstance[]).filter(
        (c) => c.catalog_id != null && myCatalogIds.has(c.catalog_id)
      );
      const coordResults = await Promise.all(
        myCourses.map(async (c) => {
          try {
            const entries = await programCoordinatorService.listCourseCoordinators(c.id);
            return [c.id, entries] as const;
          } catch {
            return [c.id, []] as const;
          }
        })
      );
      setCoordinatorsByCourse(Object.fromEntries(coordResults));
    } catch (err: any) {
      if (!silent) setError('Failed to load catalog/courses. Verify API connection.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Eligible-user picker: uses GET /auth/coordinator/eligible-users, which is
  // scoped to program coordinators (not admin-only like /auth/admin/staff), so it
  // works for a real (non-admin) Program Coordinator without a 403.
  const fetchStaffOptions = async () => {
    try {
      const data = await adminService.listCoordinatorEligibleUsers();
      setStaffOptions(data);
      setStaffPickerError('');
    } catch (err: any) {
      setStaffOptions([]);
      setStaffPickerError('Failed to load user list for the picker. Enter a user ID manually below to assign.');
    }
  };

  useAutoRefresh(() => fetchAll(true));

  useEffect(() => {
    fetchAll();
    fetchStaffOptions();
  }, []);

  const handleCreateCatalogEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await programCoordinatorService.createCatalogEntry({
        name: newName.trim(),
        code: newCode.trim(),
        prerequisite_catalog_id: newPrereq ? parseInt(newPrereq) : null,
      });
      setNewName('');
      setNewCode('');
      setNewPrereq('');
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add course to catalog.');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (entry: CatalogEntry) => {
    setEditingId(entry.id);
    setEditName(entry.name);
    setEditCode(entry.code);
    setEditPrereq(entry.prerequisite_catalog_id ? String(entry.prerequisite_catalog_id) : '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    setSavingEdit(true);
    setError('');
    try {
      await programCoordinatorService.updateCatalogEntry(id, {
        name: editName.trim(),
        code: editCode.trim(),
        prerequisite_catalog_id: editPrereq ? parseInt(editPrereq) : null,
      });
      setEditingId(null);
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update catalog entry.');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteCatalogEntry = async (id: number) => {
    setError('');
    try {
      await programCoordinatorService.deleteCatalogEntry(id);
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete catalog entry.');
    }
  };

  const updateCoursePrerequisite = async (courseId: number, prerequisiteCourseId: string) => {
    setError('');
    try {
      await programCoordinatorService.updateCourse(courseId, {
        prerequisite_course_id: prerequisiteCourseId ? parseInt(prerequisiteCourseId) : null,
      });
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update prerequisite mapping.');
    }
  };

  const deleteCourse = async (courseId: number) => {
    setError('');
    try {
      await programCoordinatorService.deleteCourse(courseId);
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete course.');
    }
  };

  const refreshCourseCoordinators = async (courseId: number) => {
    try {
      const entries = await programCoordinatorService.listCourseCoordinators(courseId);
      setCoordinatorsByCourse((prev) => ({ ...prev, [courseId]: entries }));
    } catch {
      // Leave the previous list in place rather than clearing it on a transient failure.
    }
  };

  const assignCourseCoordinator = async (courseId: number) => {
    const raw = (selectedUserByCourse[courseId] || '').trim();
    if (!raw) return;
    const userId = parseInt(raw, 10);
    if (Number.isNaN(userId)) {
      setError('Please select or enter a valid user ID.');
      return;
    }
    setError('');
    setAssigningCourseId(courseId);
    try {
      await programCoordinatorService.assignCourseCoordinator(courseId, userId);
      setSelectedUserByCourse((prev) => ({ ...prev, [courseId]: '' }));
      await refreshCourseCoordinators(courseId);
    } catch (err: any) {
      // A 403 here means this course's program isn't actually in this coordinator's
      // scope (shouldn't normally happen given server-side scoping / the client-side
      // filter above) - surface it instead of letting the rejection go unhandled.
      setError(err.response?.data?.detail || 'Failed to assign Course Coordinator.');
    } finally {
      setAssigningCourseId(null);
    }
  };

  const removeCourseCoordinator = async (courseId: number, userId: number) => {
    setError('');
    setRemovingKey(`${courseId}:${userId}`);
    try {
      await programCoordinatorService.removeCourseCoordinator(courseId, userId);
      await refreshCourseCoordinators(courseId);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to unassign Course Coordinator.');
    } finally {
      setRemovingKey(null);
    }
  };

  // "My courses" for the Course Coordinator assignment section - see fetchAll's
  // comment for why this is derived client-side from the already-scoped catalog list.
  const myCatalogIds = new Set(catalog.map((c) => c.id));
  const myCourses = courses.filter((c) => c.catalog_id != null && myCatalogIds.has(c.catalog_id));

  const navItems: NavItem[] = [
    { key: 'catalog', label: 'Course Catalog', icon: BookOpen, active: activeSection === 'catalog', onClick: () => setActiveSection('catalog') },
    { key: 'instances', label: 'Course Instances', icon: Layers, active: activeSection === 'instances', onClick: () => setActiveSection('instances') },
    { key: 'coordinators', label: 'Course Coordinators', icon: Network, active: activeSection === 'coordinators', onClick: () => setActiveSection('coordinators') },
    // Coordinator authority is layered on top of the teacher role, not a
    // replacement for it - this account still teaches its own courses too.
    ...(user?.role === 'teacher'
      ? [{ key: 'teacher', label: 'My Teacher Dashboard', icon: UserPlus, onClick: () => navigate('/teacher') }]
      : []),
  ];

  return (
    <AppShell roleLabel="Program Coordinator Portal" logoIcon={Layers} navItems={navItems}>
      <div className="space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 cursor-pointer shrink-0" onClick={() => setError('')} />
            <span>{error}</span>
          </div>
        )}

        {activeSection === 'catalog' && (
        <>
        {/* Add predefined course */}
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <Plus className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Add Predefined Course</h3>
          </div>
          <form onSubmit={handleCreateCatalogEntry} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">Course Name</label>
              <input
                type="text" required className="input-light" placeholder="e.g. Data Structures"
                value={newName} onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">Course Code</label>
              <input
                type="text" required className="input-light" placeholder="e.g. CS201"
                value={newCode} onChange={(e) => setNewCode(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">Prerequisite</label>
              <select className="input-light" value={newPrereq} onChange={(e) => setNewPrereq(e.target.value)}>
                <option value="">None</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
            <div className="flex items-end h-full">
              <button type="submit" disabled={creating} className="btn-primary w-full sm:w-auto disabled:opacity-60">
                {creating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Adding...</> : <><Plus className="w-4 h-4" /> Add</>}
              </button>
            </div>
          </form>
        </div>

        {/* Catalog list */}
        <div>
          <h3 className="text-base font-bold text-text-primary mb-4">Predefined Course Catalog</h3>
          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>
          ) : (
            <div className="space-y-3">
              {catalog.map((entry) => {
                const prereq = catalog.find((c) => c.id === entry.prerequisite_catalog_id);
                const isEditing = editingId === entry.id;
                return (
                  <div key={entry.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card">
                    {isEditing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
                        <input className="input-light" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        <input className="input-light" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                        <select className="input-light" value={editPrereq} onChange={(e) => setEditPrereq(e.target.value)}>
                          <option value="">None</option>
                          {catalog.filter((c) => c.id !== entry.id).map((c) => (
                            <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <button onClick={() => saveEdit(entry.id)} disabled={savingEdit} className="btn-primary text-xs px-3 py-2">
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button onClick={cancelEdit} className="btn-ghost text-xs px-3 py-2">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <p className="font-bold text-text-primary">{entry.name} <span className="text-text-muted font-normal">({entry.code})</span></p>
                          <p className="text-xs text-text-muted mt-0.5">
                            {prereq ? `Prerequisite: ${prereq.name}` : 'No prerequisite'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(entry)} className="btn-ghost text-xs px-3 py-1.5">
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => deleteCatalogEntry(entry.id)}
                            className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/30 dark:hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
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
        </>
        )}

        {/* Course instances - prerequisite mapping + deletion */}
        {activeSection === 'instances' && (
        <div>
          <h3 className="text-base font-bold text-text-primary mb-4">Course Instances</h3>
          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>
          ) : courses.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
              No courses created yet.
            </div>
          ) : (
            <div className="space-y-3">
              {courses.map((course) => (
                <div key={course.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-text-primary">{course.name} <span className="text-text-muted font-normal">({course.code})</span></p>
                    <p className="text-xs text-text-muted mt-0.5">{course.semester} &middot; {course.status}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      className="input-light text-xs py-1.5"
                      value={course.prerequisite_course_id ? String(course.prerequisite_course_id) : ''}
                      onChange={(e) => updateCoursePrerequisite(course.id, e.target.value)}
                    >
                      <option value="">No prerequisite</option>
                      {courses.filter((c) => c.id !== course.id).map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                      ))}
                    </select>
                    <button
                      onClick={() => deleteCourse(course.id)}
                      className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/30 dark:hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Course Coordinator assignment - pick/search a user and assign/unassign them
            as Course Coordinator for a course under this coordinator's own program(s). */}
        {activeSection === 'coordinators' && (
        <div>
          <h3 className="text-base font-bold text-text-primary mb-4">Course Coordinators</h3>
          {staffPickerError && (
            <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-3 flex items-center gap-2 text-xs mb-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{staffPickerError}</span>
            </div>
          )}
          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>
          ) : myCourses.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
              No courses under your program(s) yet.
            </div>
          ) : (
            <div className="space-y-3">
              {myCourses.map((course) => {
                const assigned = coordinatorsByCourse[course.id] || [];
                const assignedIds = new Set(assigned.map((a) => a.id));
                const eligible = staffOptions.filter((s) => !assignedIds.has(s.id));
                return (
                  <div key={course.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card space-y-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="font-bold text-text-primary">{course.name} <span className="text-text-muted font-normal">({course.code})</span></p>
                        <p className="text-xs text-text-muted mt-0.5">{course.semester} &middot; {course.status}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {assigned.length === 0 ? (
                        <span className="text-xs text-text-muted italic">No Course Coordinator assigned yet.</span>
                      ) : (
                        assigned.map((entry) => (
                          <span
                            key={entry.id}
                            className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-muted border border-primary/20 rounded-lg px-2.5 py-1.5"
                          >
                            {entry.full_name} <span className="text-text-muted font-normal">({entry.email})</span>
                            <button
                              onClick={() => removeCourseCoordinator(course.id, entry.id)}
                              disabled={removingKey === `${course.id}:${entry.id}`}
                              title="Unassign"
                              className="text-primary hover:text-rose-600 disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {staffOptions.length > 0 ? (
                        <select
                          className="input-light text-xs py-1.5 min-w-[220px]"
                          value={selectedUserByCourse[course.id] || ''}
                          onChange={(e) => setSelectedUserByCourse((prev) => ({ ...prev, [course.id]: e.target.value }))}
                        >
                          <option value="">Select a user to assign...</option>
                          {eligible.map((s) => (
                            <option key={s.id} value={s.id}>{s.full_name} ({s.email}) - {s.role}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          className="input-light text-xs py-1.5 w-40"
                          placeholder="User ID"
                          value={selectedUserByCourse[course.id] || ''}
                          onChange={(e) => setSelectedUserByCourse((prev) => ({ ...prev, [course.id]: e.target.value }))}
                        />
                      )}
                      <button
                        onClick={() => assignCourseCoordinator(course.id)}
                        disabled={assigningCourseId === course.id || !(selectedUserByCourse[course.id] || '').trim()}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-60"
                      >
                        {assigningCourseId === course.id ? (
                          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Assigning...</>
                        ) : (
                          <><UserPlus className="w-3.5 h-3.5" /> Assign</>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </AppShell>
  );
};

export default ProgramCoordinatorDashboard;
