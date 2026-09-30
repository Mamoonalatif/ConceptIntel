// Admin console: a sidebar-driven page with six sections - user directory (search/filter/
// edit/delete/CSV export), create teacher account, staff coordinator authorities,
// programs CRUD, teacher access requests and activity logs. All data comes from the
// admin APIs; most updates are applied optimistically to local state for instant feedback.
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { adminService, programService, programCoordinatorService } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { AppShell, type NavItem } from '../components/AppShell';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  Shield, Mail, CheckCircle2, XCircle, Plus, RefreshCw, Copy, Check,
  ClipboardList, UserPlus, AlertCircle, Users, BookOpen, Trash2,
  Download, Edit, Search, GraduationCap, X
} from 'lucide-react';
import { EmptyStateIllustration } from '../components/illustrations';

// Which sidebar section is currently displayed.
type AdminSection = 'users' | 'create-teacher' | 'staff-roles' | 'programs' | 'requests' | 'logs';

// A pending/approved/rejected request from someone asking for teacher access.
interface TeacherRequest {
  id: number;
  email: string;
  full_name: string;
  reason: string | null;
  status: string;
}

// Program/Course Coordinator are ADDITIVE authorities layered on top of the base
// 'teacher' role (see is_program_coordinator/is_course_coordinator below) - a
// teacher can hold either, both, or neither, and keeps every teacher capability
// regardless. `role` itself only ever varies for legacy accounts still on the
// older exclusive-role model (see program_name/course_name below), which this
// panel surfaces read-only but no longer creates.
interface StaffMember {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_program_coordinator: boolean;
  is_course_coordinator: boolean;
  // Only ever populated for legacy exclusive-role accounts (role itself equal to
  // 'program_coordinator'/'course_coordinator') - additive-authority teachers have
  // no single program/course scope, so these stay null for them.
  program_name?: string | null;
  course_name?: string | null;
}

interface UserAccount {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_program_coordinator?: boolean;
  is_course_coordinator?: boolean;
  // Only ever populated for legacy exclusive-role accounts - see StaffMember above.
  program_name?: string | null;
  course_name?: string | null;
}

// An academic program (grouping of courses).
interface Program {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
}

// A catalog subject, used as the scope option for Course Coordinators.
interface CatalogOption {
  id: number;
  name: string;
  code?: string | null;
}

// One entry in the admin activity feed.
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

// Display names for role values stored in the database.
const ROLE_LABELS: Record<string, string> = {
  teacher: 'Teacher',
  program_coordinator: 'Program Coordinator',
  course_coordinator: 'Course Coordinator',
  student: 'Student',
  admin: 'Admin',
};

// Full names may contain only letters separated by single spaces.
const FULL_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

// Page component; owns all state for every section.
const AdminDashboard: React.FC = () => {
  const location = useLocation();
  // Arriving from another page's sidebar (see lib/roleNav.ts) passes which
  // section to land on via router state, so the sidebar's admin links work
  // the same from anywhere, not just from this dashboard itself.
  const [activeSection, setActiveSection] = useState<AdminSection>(
    (location.state as { section?: AdminSection } | null)?.section || 'users'
  );

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

  // Coordinator authority management - additive is_program_coordinator/
  // is_course_coordinator flags on an existing teacher account, each one set
  // via a single combined dropdown (authority + scope in one action - see
  // handleProgramDropdownChange/handleCourseDropdownChange).
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  // Program Coordinator scope - which program each coordinator is actually
  // assigned to (single-select, mirroring the Course Coordinator dropdown).
  const [coordinatorPrograms, setCoordinatorPrograms] = useState<Record<number, Program[]>>({});
  const [assigningProgramFor, setAssigningProgramFor] = useState<number | null>(null);

  // Course Coordinator scope - which catalog SUBJECT each coordinator is
  // actually assigned to (exactly one). Scoped to the subject itself (Applied
  // Physics, Digital Logic Design, Calculus - always all 3 available), not a
  // live course section, so a coordinator can be assigned before any section
  // exists yet.
  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [coordinatorCourse, setCoordinatorCourse] = useState<Record<number, CatalogOption | null>>({});
  const [assigningCourseFor, setAssigningCourseFor] = useState<number | null>(null);

  // Manage Programs panel
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [newProgramName, setNewProgramName] = useState('');
  const [newProgramCode, setNewProgramCode] = useState('');
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [deletingProgramId, setDeletingProgramId] = useState<number | null>(null);

  // Loads the user directory (optionally filtered by role); 'silent' skips loading/error UI.
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

  // Loads the activity log, optionally filtered by event type.
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

  // Loads teacher/staff accounts with their coordinator-authority flags.
  const fetchStaff = async (silent = false) => {
    try {
      if (!silent) setStaffLoading(true);
      const data = await adminService.listStaffByAuthority();
      setStaff(data);
    } catch (err: any) {
      if (!silent) setError('Failed to fetch staff accounts. Verify API connection.');
    } finally {
      if (!silent) setStaffLoading(false);
    }
  };

  // Loads the list of programs.
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

  // Loads teacher access requests.
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

  // Load the main lists on mount and again when the role filter or tab changes.
  useEffect(() => {
    fetchUsers();
    fetchRequests();
    fetchStaff();
    fetchPrograms();
  }, [userRoleFilter, userTab]);

  // Load the activity log whenever the Logs section is opened or its filter changes.
  useEffect(() => {
    if (activeSection === 'logs') fetchLogs();
  }, [activeSection, logsEventFilter]);

  // Builds a userId -> assigned-programs map by fetching each program's
  // coordinator list once (not once per staff member) - cheap at this scale
  // (a handful of programs) and only runs when the section is actually open.
  useEffect(() => {
    // Runs regardless of which section is open (not just staff-roles) so the
    // "All Students & Users" list can show the same program/course badge info,
    // and it stays correct immediately after an assignment made elsewhere.
    if (programs.length === 0) return;
    (async () => {
      const byUser: Record<number, Program[]> = {};
      for (const program of programs) {
        try {
          const coordinators = await programService.listCoordinators(program.id);
          for (const c of coordinators) {
            (byUser[c.id] ||= []).push(program);
          }
        } catch { /* non-critical - leave that program's assignments blank */ }
      }
      setCoordinatorPrograms(byUser);
    })();
  }, [activeSection, programs]);

  // Mirrors the program-coordinator fetch above, for Course Coordinator scope -
  // fetches every catalog subject's coordinator list once, then builds a
  // userId -> subject map (a Course Coordinator is scoped to exactly one
  // subject, unlike Program Coordinator's additive multi-program scope).
  useEffect(() => {
    (async () => {
      try {
        const catalog: CatalogOption[] = await programCoordinatorService.listCatalog();
        setCatalogOptions(catalog);

        const byUser: Record<number, CatalogOption> = {};
        for (const subject of catalog) {
          try {
            const coordinators = await programCoordinatorService.listCourseCoordinators(subject.id);
            for (const c of coordinators) {
              byUser[c.id] = subject;
            }
          } catch { /* non-critical - leave that subject's assignment blank */ }
        }
        setCoordinatorCourse(byUser);
      } catch { /* non-critical - dropdown just stays empty */ }
    })();
  }, [activeSection]);

  // Single dropdown per authority type, combining "grant this authority" and
  // "scope it to this program/course" into one action - the old checkbox-then-
  // separate-Assign-button flow left it easy to toggle the authority flag
  // without ever actually creating the scope assignment underneath it, which
  // is why "no users" showed up on the Program Coordinator dashboard even
  // after checking the box. Mutually exclusive with the other dropdown -
  // picking a program clears any course assignment, and vice versa.
  // Sets (or clears) a teacher's Program Coordinator scope. Removes any previous
  // program/course scope first, updates the authority flags, then assigns the new program.
  // The UI is updated optimistically and rolled back if any API call fails.
  const handleProgramDropdownChange = async (userId: number, value: string) => {
    // Optimistic - the dropdown/badge update the instant you pick a value, not
    // after every API round trip (remove old scope, flip flags, assign new
    // scope) finishes. Reverts only if something actually fails.
    const previousPrograms = coordinatorPrograms[userId] || [];
    const previousCourse = coordinatorCourse[userId] || null;
    const previousStaff = staff;
    const previousUsers = users;

    const programId = value ? parseInt(value) : null;
    const program = programId ? programs.find((p) => p.id === programId) || null : null;

    setCoordinatorPrograms(prev => ({ ...prev, [userId]: program ? [program] : [] }));
    setCoordinatorCourse(prev => ({ ...prev, [userId]: value ? null : prev[userId] }));
    const flagPatch = value
      ? { is_program_coordinator: true, is_course_coordinator: false }
      : { is_program_coordinator: false };
    setStaff(prev => prev.map(s => (s.id === userId ? { ...s, ...flagPatch } : s)));
    setUsers(prev => prev.map(u => (u.id === userId ? { ...u, ...flagPatch } : u)));

    setAssigningProgramFor(userId);
    setError('');
    try {
      if (previousCourse) {
        await programCoordinatorService.removeCourseCoordinator(previousCourse.id, userId);
      }
      for (const p of previousPrograms) {
        await programService.removeCoordinator(p.id, userId);
      }
      await adminService.updateStaffAuthorities(userId, flagPatch);
      if (programId) {
        await programService.assignCoordinator(programId, userId);
      }
    } catch (err: any) {
      // Revert the optimistic update on real failure.
      setCoordinatorPrograms(prev => ({ ...prev, [userId]: previousPrograms }));
      setCoordinatorCourse(prev => ({ ...prev, [userId]: previousCourse }));
      setStaff(previousStaff);
      setUsers(previousUsers);
      setError(apiErrorMessage(err, 'Failed to update Program Coordinator assignment.'));
    } finally {
      setAssigningProgramFor(null);
    }
  };

  // Same as above but for the Course Coordinator authority (scoped to a catalog subject).
  const handleCourseDropdownChange = async (userId: number, value: string) => {
    // The dropdown lists catalog SUBJECTS (all 3, always) and assignment targets
    // the subject directly - no live course section is required to exist first.
    // Optimistic, same as handleProgramDropdownChange - UI updates instantly,
    // reverts only on real failure.
    const previousPrograms = coordinatorPrograms[userId] || [];
    const previousCourse = coordinatorCourse[userId] || null;
    const previousStaff = staff;
    const previousUsers = users;

    const catalogId = value ? parseInt(value) : null;
    const subject = catalogId ? catalogOptions.find((c) => c.id === catalogId) || null : null;

    setCoordinatorCourse(prev => ({ ...prev, [userId]: subject }));
    setCoordinatorPrograms(prev => ({ ...prev, [userId]: value ? [] : prev[userId] }));
    const flagPatch = value
      ? { is_course_coordinator: true, is_program_coordinator: false }
      : { is_course_coordinator: false };
    setStaff(prev => prev.map(s => (s.id === userId ? { ...s, ...flagPatch } : s)));
    setUsers(prev => prev.map(u => (u.id === userId ? { ...u, ...flagPatch } : u)));

    setAssigningCourseFor(userId);
    setError('');
    try {
      for (const p of previousPrograms) {
        await programService.removeCoordinator(p.id, userId);
      }
      if (previousCourse) {
        await programCoordinatorService.removeCourseCoordinator(previousCourse.id, userId);
      }
      await adminService.updateStaffAuthorities(userId, flagPatch);
      if (catalogId) {
        await programCoordinatorService.assignCourseCoordinator(catalogId, userId);
      }
    } catch (err: any) {
      setCoordinatorCourse(prev => ({ ...prev, [userId]: previousCourse }));
      setCoordinatorPrograms(prev => ({ ...prev, [userId]: previousPrograms }));
      setStaff(previousStaff);
      setUsers(previousUsers);
      setError(apiErrorMessage(err, 'Failed to update Course Coordinator assignment.'));
    } finally {
      setAssigningCourseFor(null);
    }
  };

  // Keeps this page live without a manual refresh - polls every 15s and refetches
  // immediately whenever the tab regains focus (e.g. admin switches back after a
  // student submitted a teacher request).
  useAutoRefresh(() => {
    fetchRequests(true);
    fetchStaff(true);
    fetchPrograms(true);
  });

  // Approves a teacher access request; the API returns temporary credentials to show the admin.
  const handleApprove = async (id: number) => {
    setProcessingId(id);
    setError('');
    try {
      const data = await adminService.approveTeacherRequest(id);
      setCredentials({ email: data.email, temporary_password: data.temporary_password });
      fetchRequests();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to approve request'));
    } finally {
      setProcessingId(null);
    }
  };

  // Rejects a teacher access request.
  const handleReject = async (id: number) => {
    setProcessingId(id);
    setError('');
    try {
      await adminService.rejectTeacherRequest(id);
      fetchRequests();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to reject request'));
    } finally {
      setProcessingId(null);
    }
  };

  // Validates the new teacher's name and sets/clears the inline error; returns validity.
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

  // Creates a teacher account directly and shows the one-time temporary credentials.
  // The new account is added to the local lists immediately.
  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validateName(newTeacherName)) return;

    setCreating(true);
    try {
      const data = await adminService.createTeacher({ email: newTeacherEmail, full_name: newTeacherName.trim() });
      setCredentials({ email: data.email, temporary_password: data.temporary_password });
      // Show up in the users/staff lists immediately - no need to wait on a
      // refetch (or a manual refresh) to see the account that was just created.
      setUsers(prev => [{
        id: data.id, email: data.email, full_name: data.full_name, role: data.role, is_active: true,
        is_program_coordinator: false, is_course_coordinator: false,
      }, ...prev]);
      setStaff(prev => [{
        id: data.id, email: data.email, full_name: data.full_name, role: data.role,
        is_program_coordinator: false, is_course_coordinator: false,
      }, ...prev]);
      setNewTeacherEmail('');
      setNewTeacherName('');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to create teacher account'));
    } finally {
      setCreating(false);
    }
  };

  // Program Coordinator and Course Coordinator are ADDITIVE authority flags on an
  // existing teacher account, independent of each other - a teacher can hold
  // either, both, or neither, and keeps every teacher capability regardless. No
  // scope panel: unlike the old exclusive-role model, these flags aren't scoped to
  // a single program/course (see adminService.updateStaffAuthorities on the
  // backend - StaffAuthoritiesUpdate has no program_ids/course_ids). Course-level
  // scoping still exists, just lives on the Program Coordinator Dashboard's
  // "Course Coordinators" section (CourseCoordinatorAssignment), independent of
  // this flag.
  // Downloads the currently filtered user list as a CSV file (via a temporary download link).
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

  // Opens the edit modal pre-filled with the chosen user's details.
  const handleOpenUserEdit = (u: UserAccount) => {
    setEditingUser(u);
    setEditForm({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: u.is_active,
    });
  };

  // Saves the edit-user form and patches the user in local lists.
  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setUpdatingUser(true);
    setError('');
    try {
      const updated = await adminService.updateUser(editingUser.id, editForm);
      // Patch the row in place instead of waiting on a full refetch - the
      // change shows up instantly rather than after a second round trip.
      setUsers(prev => prev.map(u => (u.id === updated.id ? { ...u, ...updated } : u)));
      setStaff(prev => prev.map(s => (s.id === updated.id ? { ...s, ...updated } : s)));
      setEditingUser(null);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update user profile'));
    } finally {
      setUpdatingUser(false);
    }
  };

  // Permanently deletes a user account after confirmation.
  const handleDeleteUserAccount = async (userId: number) => {
    if (!window.confirm('Are you sure you want to permanently delete this user account?')) return;
    setDeletingUserId(userId);
    setError('');
    try {
      await adminService.deleteUser(userId);
      // Remove the row immediately - no need to wait on a full refetch to
      // see the deletion reflected.
      setUsers(prev => prev.filter(u => u.id !== userId));
      setStaff(prev => prev.filter(s => s.id !== userId));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to delete user'));
    } finally {
      setDeletingUserId(null);
    }
  };

  // Creates a program from the form.
  const handleCreateProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newProgramName.trim()) return;

    setCreatingProgram(true);
    try {
      const created = await programService.create({
        name: newProgramName.trim(),
        code: newProgramCode.trim() || undefined,
      });
      setPrograms(prev => [...prev, created]);
      setNewProgramName('');
      setNewProgramCode('');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to create program'));
    } finally {
      setCreatingProgram(false);
    }
  };

  // Deletes a program.
  const handleDeleteProgram = async (programId: number) => {
    setDeletingProgramId(programId);
    setError('');
    try {
      await programService.delete(programId);
      setPrograms(prev => prev.filter(p => p.id !== programId));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to delete program'));
    } finally {
      setDeletingProgramId(null);
    }
  };

  // Copies the temporary password to the clipboard and briefly shows a check icon.
  const copyPassword = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(credentials.temporary_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Split requests into pending ones (shown first) and already-decided ones.
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

  // Sidebar entries; the requests entry shows a badge with the pending count.
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
        <span className="bg-primary-muted text-primary border border-primary/20 text-[11px] font-bold px-1.5 py-0.5 rounded-full">
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
              className="flex items-center gap-2 text-xs font-bold text-primary bg-primary-muted border border-primary/20 hover:bg-primary/10 px-4 py-2 rounded-xl transition-all disabled:opacity-60"
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
                {tab === 'all' ? 'All Users' : tab === 'students' ? 'Students' : 'Teachers & Staff'}
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
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
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
                      <option value="admin">Admin</option>
                    </select>
                    <p className="text-[12px] text-text-muted mt-1">
                      Coordinator authority is granted separately - see "Manage Coordinator Authorities".
                    </p>
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
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-primary-muted">
                      <span className="font-bold text-sm text-primary">{u.full_name?.charAt(0)?.toUpperCase() || '?'}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary text-sm truncate">{u.full_name}</p>
                      <p className="text-xs text-text-muted truncate flex items-center gap-1">
                        <Mail className="w-3 h-3 shrink-0" /> {u.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {(() => {
                      const isLegacy = u.role !== 'teacher' && u.role !== 'student' && u.role !== 'admin';
                      const assignedProgram = (coordinatorPrograms[u.id] || [])[0];
                      const assignedCourse = coordinatorCourse[u.id];
                      let label = ROLE_LABELS[u.role] || u.role;
                      if (isLegacy && (u.program_name || u.course_name)) {
                        label += ` · ${u.program_name || u.course_name}`;
                      } else if (!isLegacy && assignedProgram) {
                        label = `Program Coordinator · ${assignedProgram.name}`;
                      } else if (!isLegacy && assignedCourse) {
                        label = `Course Coordinator · ${assignedCourse.name}`;
                      }
                      return (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap bg-primary-muted text-primary border-primary/20">
                          {label}
                        </span>
                      );
                    })()}
                    {!u.is_active && (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30 whitespace-nowrap">
                        Suspended
                      </span>
                    )}
                    <button onClick={() => handleOpenUserEdit(u)}
                      className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary-muted border border-primary/20 hover:bg-primary/10 px-3 py-1.5 rounded-lg transition-all">
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
            {([['', 'All Events'], ['registration', 'Registrations'], ['enrollment', 'Enrollments'], ['request', 'Requests'], ['course', 'Courses']] as const).map(([val, label]) => (
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
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
              No events recorded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log, i) => {
                const eventIcons: Record<string, React.FC<{ className?: string }>> = {
                  registration: UserPlus, enrollment: BookOpen, request: ClipboardList, course: GraduationCap,
                };
                const EventIcon = eventIcons[log.event_type] || Users;
                return (
                  <div key={i} className="glass-panel rounded-xl px-4 py-3 border border-border shadow-card flex items-start gap-3 hover:border-primary/20 transition-all">
                    <div className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 border bg-primary-muted border-primary/20 text-primary">
                      <EventIcon className="w-3.5 h-3.5" />
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
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap bg-primary-muted text-primary border-primary/20">
                        {log.event_type}
                      </span>
                      {log.status && (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                          log.status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                            : 'bg-primary-muted text-primary border-primary/20'
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
          <div className="glass-panel rounded-2xl p-6 border border-primary/30 bg-primary-muted/60 shadow-card animate-fade-up">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-primary" />
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
                  {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
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

        {/* Manage Coordinator Authorities: grant/revoke Program/Course Coordinator
            authority on an existing teacher account. These are ADDITIVE flags, not a
            role change - a teacher keeps every teacher capability (uploading, running
            their own courses) plus whichever authority is toggled, and can hold both,
            one, or neither independently. No scope panel here: authority alone doesn't
            pin a coordinator to a single program/course under this model - see the
            "Course Coordinators" section of the Program Coordinator Dashboard for
            per-course Course Coordinator assignment, which stays independently scoped. */}
        {activeSection === 'staff-roles' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Manage Coordinator Authorities</h3>
          </div>
          <p className="text-xs text-text-muted mb-4 max-w-2xl">
            Program Coordinator and Course Coordinator are ADDITIONAL authorities on top of the
            teacher role, not a replacement for it - a teacher given one (or both) keeps every
            teacher capability, plus the coordinator ones. No new account or password is created.
          </p>

          {staffLoading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              Loading staff...
            </div>
          ) : staff.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
              No teacher accounts yet. Create one above, then grant coordinator authority here.
            </div>
          ) : (
            <div className="space-y-3">
              {staff.map((member) => {
                const isLegacyExclusiveRole = member.role !== 'teacher';
                return (
                <div key={member.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-text-primary">{member.full_name}</p>
                    <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                      <Mail className="w-3 h-3" /> {member.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => {
                      // Legacy exclusive-role accounts (role IS "program_coordinator"/
                      // "course_coordinator") keep their own role label + scope name.
                      // Additive accounts (role "teacher" + a flag) show the authority
                      // title itself - "Program Coordinator"/"Course Coordinator" - not
                      // "Teacher", whenever a scope is actually assigned; falling back
                      // to "Teacher" only when neither dropdown has a value.
                      const assignedProgram = (coordinatorPrograms[member.id] || [])[0];
                      const assignedCourse = coordinatorCourse[member.id];
                      let label = ROLE_LABELS[member.role] || member.role;
                      if (isLegacyExclusiveRole && (member.program_name || member.course_name)) {
                        label += ` · ${member.program_name || member.course_name}`;
                      } else if (!isLegacyExclusiveRole && assignedProgram) {
                        label = `Program Coordinator · ${assignedProgram.name}`;
                      } else if (!isLegacyExclusiveRole && assignedCourse) {
                        label = `Course Coordinator · ${assignedCourse.name}`;
                      }
                      return (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap bg-primary-muted text-primary border-primary/20">
                          {label}
                        </span>
                      );
                    })()}
                    {isLegacyExclusiveRole ? (
                      <span className="text-xs text-text-muted italic" title="This account predates the additive-authority model and still holds an exclusive coordinator role. Move it back to Teacher via Edit User to grant additive authorities instead.">
                        Legacy exclusive-role account - authorities not applicable
                      </span>
                    ) : (
                      <>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[11px] font-semibold text-text-muted">Program Coordinator</label>
                          <select
                            className="input-light text-xs py-1"
                            value={(coordinatorPrograms[member.id] || [])[0]?.id ?? ''}
                            disabled={assigningProgramFor === member.id || member.is_course_coordinator}
                            title={member.is_course_coordinator ? 'Already Course Coordinator - set that dropdown to None first.' : undefined}
                            onChange={(e) => handleProgramDropdownChange(member.id, e.target.value)}
                          >
                            <option value="">None</option>
                            {programs.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[11px] font-semibold text-text-muted">Course Coordinator</label>
                          <select
                            className="input-light text-xs py-1"
                            value={coordinatorCourse[member.id]?.id ?? ''}
                            disabled={assigningCourseFor === member.id || member.is_program_coordinator}
                            title={member.is_program_coordinator ? 'Already Program Coordinator - set that dropdown to None first.' : undefined}
                            onChange={(e) => handleCourseDropdownChange(member.id, e.target.value)}
                          >
                            <option value="">None</option>
                            {catalogOptions.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Manage Programs: admin-only CRUD over the Program grouping used by the
            course catalog. Model-agnostic - unrelated to how coordinator authority
            is granted (see "Manage Coordinator Authorities" above). */}
        {activeSection === 'programs' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Manage Programs</h3>
          </div>
          <p className="text-xs text-text-muted mb-4 max-w-2xl">
            Programs group courses (e.g. "Computer Science") for the course catalog and reporting.
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
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
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
              <span className="bg-primary-muted text-primary border border-primary/20 text-xs font-bold px-2 py-0.5 rounded-full">
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
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
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
                          className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary-muted border border-primary/20 hover:bg-primary/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
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
                          ? 'bg-primary-muted text-primary border-primary/20'
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
