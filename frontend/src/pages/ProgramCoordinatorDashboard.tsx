import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { programCoordinatorService, courseService } from '../services/api';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  LogOut, User, Layers, Plus, RefreshCw, AlertCircle, Pencil, Trash2, X, Check, KeyRound,
} from 'lucide-react';

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
}

const ProgramCoordinatorDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);

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

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [catalogData, coursesData] = await Promise.all([
        programCoordinatorService.listCatalog(),
        courseService.getAll(),
      ]);
      setCatalog(catalogData);
      setCourses(coursesData);
    } catch (err: any) {
      if (!silent) setError('Failed to load catalog/courses. Verify API connection.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useAutoRefresh(() => fetchAll(true));

  useEffect(() => {
    fetchAll();
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

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="page-bg-decoration" />

      <header className="glass-panel sticky top-0 z-30 border-b border-border shadow-soft">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold gradient-text leading-tight">ConceptIntel</h1>
              <p className="text-[10px] text-text-muted">Program Coordinator Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-primary-muted border border-primary/20 rounded-lg px-3 py-1.5">
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
              className="p-2 text-text-muted hover:text-rose-500 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 relative z-10 space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 cursor-pointer shrink-0" onClick={() => setError('')} />
            <span>{error}</span>
          </div>
        )}

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
                            className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-all"
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

        {/* Course instances - prerequisite mapping + deletion */}
        <div>
          <h3 className="text-base font-bold text-text-primary mb-4">Course Instances</h3>
          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>
          ) : courses.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">No courses created yet.</div>
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
                      className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
};

export default ProgramCoordinatorDashboard;
