import React, { useState, useEffect } from 'react';
import { adminService, programService, courseService } from '../services/api';
import { AppShell, type NavItem } from '../components/AppShell';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  Shield, Mail, CheckCircle2, XCircle, Plus, RefreshCw, Copy, Check,
  ClipboardList, UserPlus, AlertCircle, Users, BookOpen, Trash2,
  Download, Edit, Search, GraduationCap, X
} from 'lucide-react';

type AdminSection = 'users' | 'create-teacher' | 'staff-roles' | 'programs' | 'requests' | 'logs';

interface TeacherRequest {
  id: number;
  email: string;
  full_name: string;
  reason: string | null;
  status: string;
}

type StaffRole = 'teacher' | 'program_coordinator' | 'course_coordinator';

interface StaffMember {
  id: number;
  email: string;
  full_name: string;
  role: StaffRole;
  program_name?: string | null;
  course_name?: string | null;
}

interface UserAccount {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

interface CourseOption {
  id: number;
  name: string;
  code: string | null;
}

interface Program {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
}

interface AdminLog {
  event_type: string;
  description: string;
  actor: string;
  actor_email: string;
  role: string;
  is_active: boolean;
  timestamp: string | null;
  sort_key: number;
  extra?: string;
  status?: string;
}

const ROLE_LABELS: Record<string, string> = {
  teacher: 'Teacher',
  program_coordinator: 'Program Coordinator',
  course_coordinator: 'Course Coordinator',
  student: 'Student',
  admin: 'Admin',
};

const FULL_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

const AdminDashboard: React.FC = () => {
  const [activeSection, setActiveSection] = useState<AdminSection>('users');

  const [requests, setRequests] = useState<TeacherRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  const [credentials, setCredentials] = useState<{ email: string; temporary_password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Direct teacher creation form
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherName, setNewTeacherName] = useState('');
  const [nameError, setNameError] = useState('');
  const [creating, setCreating] = useState(false);

  // User & Student Management state — tabs + filters
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('');
  const [userStatusFilter, setUserStatusFilter] = useState<string>('');   // '' | 'active' | 'suspended'
  const [userTab, setUserTab] = useState<'all' | 'students' | 'teachers'>('all');
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', email: '', role: 'student', is_active: true });
  const [updatingUser, setUpdatingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  // Activity logs state
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsEventFilter, setLogsEventFilter] = useState<string>('');

  // Staff role management
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [changingRoleId, setChangingRoleId] = useState<number | null>(null);

  // Inline scope picker
  const [scopePanelStaffId, setScopePanelStaffId] = useState<number | null>(null);
  const [scopePanelRole, setScopePanelRole] = useState<StaffRole | null>(null);
  const [scopeProgramIds, setScopeProgramIds] = useState<number[]>([]);
  const [scopeCourseIds, setScopeCourseIds] = useState<number[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);

  // Manage Programs panel
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [newProgramName, setNewProgramName] = useState('');
  const [newProgramCode, setNewProgramCode] = useState('');
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [deletingProgramId, setDeletingProgramId] = useState<number | null>(null);

  // All courses (deduplicated)
  const [allCourses, setAllCourses] = useState<CourseOption[]>([]);
  const [allCoursesLoaded, setAllCoursesLoaded] = useState(false);

  const fetchUsers = async (silent = false) => {
    try {
      if (!silent) setUsersLoading(true);
      const roleParam = userRoleFilter || (userTab === 'students' ? 'student' : userTab === 'teachers' ? undefined : undefined);
      const data = await adminService.listAllUsers(
        roleParam || userRoleFilter ? { role: roleParam || userRoleFilter } : undefined
      );
      setUsers(data);
    } catch (err: any) {
      if (!silent) setError('Failed to fetch user directory.');
    } finally {
      if (!silent) setUsersLoading(false);
    }
  };

  const fetchLogs = async (silent = false) => {
    try {
      if (!silent) setLogsLoading(true);
      const data = await adminService.listAdminLogs(logsEventFilter || undefined);
      setLogs(data);
    } catch {
      // non-fatal
    } finally {
      if (!silent) setLogsLoading(false);
    }
  };

  const fetchStaff = async (silent = false) => {
    try {
      if (!silent) setStaffLoading(true);
      const data = await adminService.listStaff();
      setStaff(data);
    } catch (err: any) {
      if (!silent) setError('Failed to fetch staff accounts. Verify API connection.');
    } finally {
      if (!silent) setStaffLoading(false);
    }
  };

  const fetchPrograms = async (silent = false) => {
    try {
      if (!silent) setProgramsLoading(true);
      const data = await programService.list();
      setPrograms(data);
    } catch (err: any) {
      if (!silent) setError('Failed to fetch programs. Verify API connection.');
    } finally {
      if (!silent) setProgramsLoading(false);
    }
  };

  const fetchRequests = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await adminService.listTeacherRequests();
      setRequests(data);
    } catch (err: any) {
      if (!silent) setError('Failed to fetch teacher requests. Verify API connection.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchRequests();
    fetchStaff();
    fetchPrograms();
  }, [userRoleFilter, userTab]);

  useEffect(() => {
    if (activeSection === 'logs') fetchLogs();
  }, [activeSection, logsEventFilter]);

  // Keeps this page live without a manual refresh - polls every 15s and refetches
  // immediately whenever the tab regains focus (e.g. admin switches back after a
  // student submitted a teacher request).
  useAutoRefresh(() => {
    fetchRequests(true);
    fetchStaff(true);
    fetchPrograms(true);
  });

  const handleApprove = async (id: number) => {
    setProcessingId(id);
    setError('');
    try {
      const data = await adminService.approveTeacherRequest(id);
      setCredentials({ email: data.email, temporary_password: data.temporary_password });
      fetchRequests();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to approve request');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: number) => {
    setProcessingId(id);
    setError('');
    try {
      await adminService.rejectTeacherRequest(id);
      fetchRequests();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reject request');
    } finally {
      setProcessingId(null);
    }
  };

  const validateName = (value: string) => {
    if (!value.trim()) {
      setNameError('Full name is required');
      return false;
    }
    if (!FULL_NAME_PATTERN.test(value.trim())) {
      setNameError('Only letters and spaces are allowed');
      return false;
    }
    setNameError('');
    return true;
  };

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validateName(newTeacherName)) return;

    setCreating(true);
    try {
      const data = await adminService.createTeacher({ email: newTeacherEmail, full_name: newTeacherName.trim() });
      setCredentials({ email: data.email, temporary_password: data.temporary_password });
      setNewTeacherEmail('');
      setNewTeacherName('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create teacher account');
    } finally {
      setCreating(false);
    }
  };

  // Teacher needs no scope, so it fires immediately, same as before. Program/Course
  // Coordinator instead open an inline picker below the row - the actual role+scope
  // change is only sent once the admin clicks Save in that panel.
  const handleRoleSelect = async (staffId: number, role: StaffRole) => {
    setError('');
    if (role === 'teacher') {
      setChangingRoleId(staffId);
      try {
        await adminService.changeStaffRole(staffId, role);
        fetchStaff();
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to change role');
      } finally {
        setChangingRoleId(null);
      }
      return;
    }
    await openScopePanel(staffId, role);
  };

  const openScopePanel = async (staffId: number, role: StaffRole) => {
    setScopePanelStaffId(staffId);
    setScopePanelRole(role);
    setScopeProgramIds([]);
    setScopeCourseIds([]);
    setScopeLoading(true);
    setError('');
    try {
      if (role === 'course_coordinator' && !allCoursesLoaded) {
        const courses = await courseService.getAll();
        // Deduplicate courses by course name to support centralized knowledge graph view
        const uniqueCourses = courses.reduce((acc: CourseOption[], curr: CourseOption) => {
          if (!acc.some(item => item.name.trim().toLowerCase() === curr.name.trim().toLowerCase())) {
            acc.push(curr);
          }
          return acc;
        }, []);
        setAllCourses(uniqueCourses);
        setAllCoursesLoaded(true);
      }
      const currentScope = await adminService.listStaffScope(staffId);
      setScopeProgramIds(currentScope.program_ids || []);
      setScopeCourseIds(currentScope.course_ids || []);
    } catch (err: any) {
      setError('Failed to load current scope for this staff member.');
    } finally {
      setScopeLoading(false);
    }
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    setError('');
    try {
      // Build role param based on active tab or explicit role filter
      const roleForExport = userRoleFilter || (
        userTab === 'students' ? 'student' :
        userTab === 'teachers' ? 'teacher' :
        undefined
      );
      const isActiveParam = userStatusFilter === 'active' ? true : userStatusFilter === 'suspended' ? false : undefined;
      const blob = await adminService.exportUsersCsv({
        role: roleForExport,
        search: userSearch.trim() || undefined,
        is_active: isActiveParam,
      });
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `conceptintel_users${roleForExport ? `_${roleForExport}` : ''}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setError('Failed to export CSV file.');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleOpenUserEdit = (u: UserAccount) => {
    setEditingUser(u);
    setEditForm({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: u.is_active,
    });
  };

  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setUpdatingUser(true);
    setError('');
    try {
      await adminService.updateUser(editingUser.id, editForm);
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update user profile');
    } finally {
      setUpdatingUser(false);
    }
  };

  const handleDeleteUserAccount = async (userId: number) => {
    if (!window.confirm('Are you sure you want to permanently delete this user account?')) return;
    setDeletingUserId(userId);
    setError('');
    try {
      await adminService.deleteUser(userId);
      fetchUsers();
      fetchStaff();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const closeScopePanel = () => {
    setScopePanelStaffId(null);
    setScopePanelRole(null);
    setScopeProgramIds([]);
    setScopeCourseIds([]);
  };

  const selectScopeProgram = (programId: number) => {
    setScopeProgramIds([programId]);
  };

  const selectScopeCourse = (courseId: number) => {
    setScopeCourseIds([courseId]);
  };

  const handleSaveScope = async () => {
    if (scopePanelStaffId === null || scopePanelRole === null) return;
    setScopeSaving(true);
    setError('');
    try {
      await adminService.changeStaffRole(scopePanelStaffId, scopePanelRole, {
        program_ids: scopePanelRole === 'program_coordinator' ? scopeProgramIds : undefined,
        course_ids: scopePanelRole === 'course_coordinator' ? scopeCourseIds : undefined,
      });
      closeScopePanel();
      fetchStaff();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to change role');
    } finally {
      setScopeSaving(false);
    }
  };

  const handleCreateProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newProgramName.trim()) return;

    setCreatingProgram(true);
    try {
      await programService.create({
        name: newProgramName.trim(),
        code: newProgramCode.trim() || undefined,
      });
      setNewProgramName('');
      setNewProgramCode('');
      fetchPrograms();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create program');
    } finally {
      setCreatingProgram(false);
    }
  };

  const handleDeleteProgram = async (programId: number) => {
    setDeletingProgramId(programId);
    setError('');
    try {
      await programService.delete(programId);
      fetchPrograms();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete program');
    } finally {
      setDeletingProgramId(null);
    }
  };

  const copyPassword = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(credentials.temporary_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const otherRequests = requests.filter(r => r.status !== 'pending');

  // Client-side filter pipeline on top of already role-filtered server data
  const filteredUsers = users.filter(u => {
    // Tab filter
    if (userTab === 'students' && u.role !== 'student') return false;
    if (userTab === 'teachers' && !['teacher', 'program_coordinator', 'course_coordinator'].includes(u.role)) return false;
    // Status filter
    if (userStatusFilter === 'active' && !u.is_active) return false;
    if (userStatusFilter === 'suspended' && u.is_active) return false;
    // Search
    const q = userSearch.trim().toLowerCase();
    if (q && !u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !u.role.toLowerCase().includes(q)) return false;
    return true;
  });

  const navItems: NavItem[] = [
    { key: 'users', label: 'All Students & Users', icon: Users, active: activeSection === 'users', onClick: () => setActiveSection('users') },
    { key: 'create-teacher', label: 'Create Teacher Account', icon: UserPlus, active: activeSection === 'create-teacher', onClick: () => setActiveSection('create-teacher') },
    { key: 'staff-roles', label: 'Manage Staff Roles', icon: GraduationCap, active: activeSection === 'staff-roles', onClick: () => setActiveSection('staff-roles') },
    { key: 'programs', label: 'Manage Programs', icon: BookOpen, active: activeSection === 'programs', onClick: () => setActiveSection('programs') },
    {
      key: 'requests',
      label: 'Teacher Access Requests',
      icon: ClipboardList,
      active: activeSection === 'requests',
      onClick: () => setActiveSection('requests'),
      badge: pendingRequests.length > 0 ? (
        <span className="bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          {pendingRequests.length}
        </span>
      ) : undefined,
    },
    { key: 'logs', label: 'Activity Logs', icon: Download, active: activeSection === 'logs', onClick: () => setActiveSection('logs') },
  ];

  return (
    <AppShell roleLabel="Admin Console" logoIcon={Shield} navItems={navItems}>
      <div className="space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 cursor-pointer shrink-0" onClick={() => setError('')} />
            <span>{error}</span>
          </div>
        )}

        {activeSection === 'users' && (
        <div>
          {/* Header row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <h3 className="text-base font-bold text-text-primary">All Students & Users</h3>
              <span className="bg-primary-muted text-primary border border-primary/20 text-xs font-bold px-2.5 py-0.5 rounded-full">
                {filteredUsers.length}
              </span>
            </div>
            <button
              onClick={handleExportCsv}
              disabled={exportingCsv}
              title="Export currently visible users as CSV"
              className="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 px-4 py-2 rounded-xl transition-all disabled:opacity-60"
            >
              {exportingCsv ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export {filteredUsers.length} rows
            </button>
          </div>

          {/* Tab Pills: All / Students / Teachers & Staff */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['all', 'students', 'teachers'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setUserTab(tab); setUserRoleFilter(''); }}
                className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  userTab === tab
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-surface text-text-secondary border-border hover:border-primary/40 hover:text-primary'
                }`}
              >
                {tab === 'all' ? 'All Users' : tab === 'students' ? '🎓 Students' : '🏫 Teachers & Staff'}
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search by name or email…"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="input-light pl-9 w-full"
              />
            </div>

            {/* Role sub-filter (only relevant on All tab) */}
            {userTab === 'all' && (
              <select
                value={userRoleFilter}
                onChange={e => setUserRoleFilter(e.target.value)}
                className="input-light w-full sm:w-44"
              >
                <option value="">All Roles</option>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
                <option value="program_coordinator">Program Coordinators</option>
                <option value="course_coordinator">Course Coordinators</option>
                <option value="admin">Admins</option>
              </select>
            )}

            {/* Status filter */}
            <select
              value={userStatusFilter}
              onChange={e => setUserStatusFilter(e.target.value)}
              className="input-light w-full sm:w-40"
            >
              <option value="">All Statuses</option>
              <option value="active">✅ Active</option>
              <option value="suspended">🚫 Suspended</option>
            </select>
          </div>

          {/* Edit User Modal */}
          {editingUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
              <div className="glass-panel rounded-2xl p-7 border border-border shadow-card w-full max-w-md animate-fade-up">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="font-bold text-text-primary flex items-center gap-2">
                    <Edit className="w-4 h-4 text-primary" /> Edit User
                  </h4>
                  <button onClick={() => setEditingUser(null)} className="text-text-muted hover:text-text-primary">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleSaveUserEdit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-text-secondary mb-1.5">Full Name</label>
                    <input type="text" required className="input-light w-full" value={editForm.full_name}
                      onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-text-secondary mb-1.5">Email</label>
                    <input type="email" required className="input-light w-full" value={editForm.email}
                      onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-text-secondary mb-1.5">Role</label>
                    <select className="input-light w-full" value={editForm.role}
                      onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="program_coordinator">Program Coordinator</option>
                      <option value="course_coordinator">Course Coordinator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="edit-is-active" checked={editForm.is_active}
                      onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="rounded border-border" />
                    <label htmlFor="edit-is-active" className="text-sm font-medium text-text-secondary">Active account</label>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={updatingUser}
                      className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                      {updatingUser ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</> : <>Save Changes</>}
                    </button>
                    <button type="button" onClick={() => setEditingUser(null)}
                      className="flex-1 text-sm font-semibold text-text-muted hover:text-text-secondary border border-border rounded-xl px-4 py-2 hover:bg-surface transition-all">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* User list */}
          {usersLoading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading users…</div>
          ) : filteredUsers.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              No users match the current filters.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map(u => (
                <div key={u.id} className="glass-panel rounded-xl p-4 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap hover:border-primary/20 transition-all">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      u.role === 'student' ? 'bg-emerald-100 dark:bg-emerald-500/15' :
                      u.role === 'admin' ? 'bg-purple-100 dark:bg-purple-500/15' :
                      'bg-blue-100 dark:bg-blue-500/15'
                    }`}>
                      <span className={`font-bold text-sm ${
                        u.role === 'student' ? 'text-emerald-700 dark:text-emerald-400' :
                        u.role === 'admin' ? 'text-purple-700 dark:text-purple-400' :
                        'text-blue-700 dark:text-blue-400'
                      }`}>{u.full_name?.charAt(0)?.toUpperCase() || '?'}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary text-sm truncate">{u.full_name}</p>
                      <p className="text-xs text-text-muted truncate flex items-center gap-1">
                        <Mail className="w-3 h-3 shrink-0" /> {u.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${
                      u.role === 'admin' ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/30'
                      : u.role === 'teacher' || u.role === 'program_coordinator' || u.role === 'course_coordinator'
                        ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                    }`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                    {!u.is_active && (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30 whitespace-nowrap">
                        Suspended
                      </span>
                    )}
                    <button onClick={() => handleOpenUserEdit(u)}
                      className="flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/10 dark:border-blue-500/30 px-3 py-1.5 rounded-lg transition-all">
                      <Edit className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button onClick={() => handleDeleteUserAccount(u.id)} disabled={deletingUserId === u.id}
                      className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/30 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60">
                      {deletingUserId === u.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* ── ACTIVITY LOGS ── */}
        {activeSection === 'logs' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              <h3 className="text-base font-bold text-text-primary">Activity Logs</h3>
              <span className="bg-primary-muted text-primary border border-primary/20 text-xs font-bold px-2.5 py-0.5 rounded-full">{logs.length}</span>
            </div>
            <button onClick={() => fetchLogs()}
              className="flex items-center gap-2 text-xs font-bold text-primary bg-primary-muted border border-primary/20 hover:bg-primary/10 px-4 py-2 rounded-xl transition-all">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {/* Event type filter pills */}
          <div className="flex gap-2 mb-5 flex-wrap">
            {([['', 'All Events'], ['registration', '👤 Registrations'], ['enrollment', '📚 Enrollments'], ['request', '📋 Requests'], ['course', '🏛️ Courses']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setLogsEventFilter(val)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  logsEventFilter === val
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-text-secondary border-border hover:border-primary/40 hover:text-primary'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {logsLoading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading logs…</div>
          ) : logs.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">No events recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {logs.map((log, i) => {
                const eventColors: Record<string,string> = {
                  registration: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/30',
                  enrollment:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30',
                  request:      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30',
                  course:       'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/30',
                };
                const eventIcons: Record<string,string> = { registration:'👤', enrollment:'📚', request:'📋', course:'🏛️' };
                return (
                  <div key={i} className="glass-panel rounded-xl px-4 py-3 border border-border shadow-card flex items-start gap-3 hover:border-primary/20 transition-all">
                    <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm border ${eventColors[log.event_type] || 'bg-surface border-border'}`}>
                      {eventIcons[log.event_type] || '•'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary leading-snug">{log.description}</p>
                      <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
                        <Mail className="w-3 h-3 shrink-0" />{log.actor_email}
                        {log.timestamp && (
                          <> · <span>{new Date(log.timestamp).toLocaleString()}</span></>
                        )}
                        {log.extra && <> · <span className="text-text-muted">{log.extra}</span></>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${eventColors[log.event_type] || 'bg-surface border-border text-text-muted'}`}>
                        {log.event_type}
                      </span>
                      {log.status && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                          log.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                          : log.status === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                          : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30'
                        }`}>{log.status}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {activeSection === 'create-teacher' && (
        <>
        {credentials && (
          <div className="glass-panel rounded-2xl p-6 border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/10 shadow-card animate-fade-up">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-base font-bold text-text-primary">Teacher account created</h3>
            </div>
            <p className="text-sm text-text-secondary mb-3">
              Relay these one-time credentials to the teacher (there is no automated email delivery):
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm">
                <span className="text-text-muted">Email: </span>
                <span className="font-semibold text-text-primary">{credentials.email}</span>
              </div>
              <div className="flex-1 flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2 text-sm">
                <span className="text-text-muted">Temp Password: </span>
                <span className="font-mono font-bold text-text-primary select-all">{credentials.temporary_password}</span>
                <button onClick={copyPassword} className="ml-auto text-text-muted hover:text-primary" title="Copy password">
                  {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Teacher Directly */}
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Create Teacher Account</h3>
          </div>
          <form onSubmit={handleCreateTeacher} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">Full Name</label>
              <input
                type="text"
                required
                className="input-light"
                placeholder="e.g. Dr. Jane Smith"
                value={newTeacherName}
                onChange={(e) => {
                  setNewTeacherName(e.target.value);
                  if (nameError) validateName(e.target.value);
                }}
                onBlur={(e) => validateName(e.target.value)}
              />
              {nameError && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{nameError}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">Email</label>
              <input
                type="email"
                required
                className="input-light"
                placeholder="teacher@university.edu"
                value={newTeacherEmail}
                onChange={(e) => setNewTeacherEmail(e.target.value)}
              />
            </div>
            <div className="flex items-end h-full">
              <button
                type="submit"
                disabled={creating}
                className="btn-primary w-full sm:w-auto disabled:opacity-60"
              >
                {creating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create</>}
              </button>
            </div>
          </form>
        </div>
        </>
        )}

        {/* Manage Staff Roles: promote/demote an existing teacher/coordinator */}
        {activeSection === 'staff-roles' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Manage Staff Roles</h3>
          </div>
          <p className="text-xs text-text-muted mb-4 max-w-2xl">
            Program Coordinator and Course Coordinator are role changes on an existing account -
            no new account or password is created. Pick a teacher/coordinator below and assign them a role.
          </p>

          {staffLoading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              Loading staff...
            </div>
          ) : staff.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              No teacher/coordinator accounts yet. Create a teacher above, then promote them here.
            </div>
          ) : (
            <div className="space-y-3">
              {staff.map((member) => (
                <div key={member.id} className="glass-panel rounded-2xl border border-border shadow-card overflow-hidden">
                  <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-bold text-text-primary">{member.full_name}</p>
                      <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3" /> {member.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap bg-primary-muted text-primary border-primary/20">
                        {ROLE_LABELS[member.role]}
                        {(member.role === 'program_coordinator' && member.program_name) ||
                         (member.role === 'course_coordinator' && member.course_name)
                          ? ` · ${member.role === 'program_coordinator' ? member.program_name : member.course_name}`
                          : ''}
                      </span>
                      <select
                        className="input-light text-xs py-1.5"
                        value={member.role}
                        disabled={changingRoleId === member.id}
                        onChange={(e) => handleRoleSelect(member.id, e.target.value as StaffRole)}
                      >
                        <option value="teacher">Teacher</option>
                        <option value="program_coordinator">Program Coordinator</option>
                        <option value="course_coordinator">Course Coordinator</option>
                      </select>
                    </div>
                  </div>

                  {scopePanelStaffId === member.id && scopePanelRole && (
                    <div className="border-t border-border bg-primary-muted/30 p-5">
                      <p className="text-xs font-bold text-text-secondary mb-3">
                        Assign as {ROLE_LABELS[scopePanelRole]} - select {scopePanelRole === 'program_coordinator' ? 'a single program' : 'a single course'} to scope them to:
                      </p>

                      {scopeLoading ? (
                        <p className="text-xs text-text-muted">Loading current scope...</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2 mb-4 max-h-48 overflow-y-auto">
                            {scopePanelRole === 'program_coordinator' ? (
                              programs.length === 0 ? (
                                <p className="text-xs text-text-muted">No programs exist yet - create one below first.</p>
                              ) : (
                                programs.map((program) => (
                                  <label
                                    key={program.id}
                                    className="flex items-center gap-2 text-xs bg-surface border border-border rounded-lg px-3 py-1.5 cursor-pointer"
                                  >
                                    <input
                                      type="radio"
                                      name="scope-program"
                                      checked={scopeProgramIds.includes(program.id)}
                                      onChange={() => selectScopeProgram(program.id)}
                                    />
                                    {program.name}{program.code ? ` (${program.code})` : ''}
                                  </label>
                                ))
                              )
                            ) : allCourses.length === 0 ? (
                              <p className="text-xs text-text-muted">No courses exist yet.</p>
                            ) : (
                              allCourses.map((course) => (
                                <label
                                  key={course.id}
                                  className="flex items-center gap-2 text-xs bg-surface border border-border rounded-lg px-3 py-1.5 cursor-pointer"
                                >
                                  <input
                                    type="radio"
                                    name="scope-course"
                                    checked={scopeCourseIds.includes(course.id)}
                                    onChange={() => selectScopeCourse(course.id)}
                                  />
                                  {course.name}{course.code ? ` (${course.code})` : ''}
                                </label>
                              ))
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleSaveScope}
                              disabled={scopeSaving}
                              className="btn-primary text-xs py-1.5 px-4 disabled:opacity-60"
                            >
                              {scopeSaving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Save'}
                            </button>
                            <button
                              onClick={closeScopePanel}
                              disabled={scopeSaving}
                              className="text-xs font-semibold text-text-muted hover:text-text-secondary px-3 py-1.5"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Manage Programs: admin-only CRUD over the Program grouping used to scope
            Program Coordinators (and, through course-catalog membership, Course Coordinators). */}
        {activeSection === 'programs' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Manage Programs</h3>
          </div>
          <p className="text-xs text-text-muted mb-4 max-w-2xl">
            Programs group courses (e.g. "Computer Science"). Program Coordinators are scoped to one or more programs above.
          </p>

          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card mb-4">
            <form onSubmit={handleCreateProgram} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5">Program Name</label>
                <input
                  type="text"
                  required
                  className="input-light"
                  placeholder="e.g. Computer Science"
                  value={newProgramName}
                  onChange={(e) => setNewProgramName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1.5">Code (optional)</label>
                <input
                  type="text"
                  className="input-light"
                  placeholder="e.g. CS"
                  value={newProgramCode}
                  onChange={(e) => setNewProgramCode(e.target.value)}
                />
              </div>
              <div className="flex items-end h-full">
                <button
                  type="submit"
                  disabled={creatingProgram}
                  className="btn-primary w-full sm:w-auto disabled:opacity-60"
                >
                  {creatingProgram ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create</>}
                </button>
              </div>
            </form>
          </div>

          {programsLoading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              Loading programs...
            </div>
          ) : programs.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              No programs yet. Create one above.
            </div>
          ) : (
            <div className="space-y-3">
              {programs.map((program) => (
                <div key={program.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-text-primary">{program.name}</p>
                    {program.code && <p className="text-xs text-text-muted mt-0.5">Code: {program.code}</p>}
                  </div>
                  <button
                    onClick={() => handleDeleteProgram(program.id)}
                    disabled={deletingProgramId === program.id}
                    className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/30 dark:hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Teacher Requests */}
        {activeSection === 'requests' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Teacher Access Requests</h3>
            {pendingRequests.length > 0 && (
              <span className="bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30 text-xs font-bold px-2 py-0.5 rounded-full">
                {pendingRequests.length} pending
              </span>
            )}
          </div>

          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              Loading requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              No teacher access requests yet.
            </div>
          ) : (
            <div className="space-y-3">
              {[...pendingRequests, ...otherRequests].map((req) => (
                <div key={req.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-text-primary">{req.full_name}</p>
                    <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                      <Mail className="w-3 h-3" /> {req.email}
                    </p>
                    {req.reason && <p className="text-sm text-text-secondary mt-2 max-w-md">{req.reason}</p>}
                  </div>

                  <div className="flex items-center gap-3">
                    {req.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={processingId === req.id}
                          className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          disabled={processingId === req.id}
                          className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/30 dark:hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </>
                    ) : (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                        req.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                          : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                      }`}>
                        {req.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </AppShell>
  );
};

export default AdminDashboard;
