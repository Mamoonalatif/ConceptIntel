import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { adminService } from '../services/api';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  LogOut, User, Shield, Mail, CheckCircle2, XCircle, Plus, RefreshCw, Copy, Check,
  ClipboardList, UserPlus, AlertCircle, Users, KeyRound
} from 'lucide-react';

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
}

const ROLE_LABELS: Record<StaffRole, string> = {
  teacher: 'Teacher',
  program_coordinator: 'Program Coordinator',
  course_coordinator: 'Course Coordinator',
};

const FULL_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);

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

  // Staff role management: promote/demote an existing teacher/coordinator
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [changingRoleId, setChangingRoleId] = useState<number | null>(null);

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
    fetchRequests();
    fetchStaff();
  }, []);

  // Keeps this page live without a manual refresh - polls every 15s and refetches
  // immediately whenever the tab regains focus (e.g. admin switches back after a
  // student submitted a teacher request).
  useAutoRefresh(() => {
    fetchRequests(true);
    fetchStaff(true);
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

  const handleChangeRole = async (staffId: number, role: StaffRole) => {
    setChangingRoleId(staffId);
    setError('');
    try {
      await adminService.changeStaffRole(staffId, role);
      fetchStaff();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to change role');
    } finally {
      setChangingRoleId(null);
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

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="page-bg-decoration" />

      {/* Header */}
      <header className="glass-panel sticky top-0 z-30 border-b border-border shadow-soft">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold gradient-text leading-tight">ConceptIntel</h1>
              <p className="text-[10px] text-text-muted">Admin Portal</p>
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
              id="admin-logout"
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

        {credentials && (
          <div className="glass-panel rounded-2xl p-6 border border-emerald-200 bg-emerald-50/40 shadow-card animate-fade-up">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
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
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
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
              {nameError && <p className="text-xs text-red-600 mt-1.5">{nameError}</p>}
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

        {/* Manage Staff Roles: promote/demote an existing teacher/coordinator */}
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
                <div key={member.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-text-primary">{member.full_name}</p>
                    <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                      <Mail className="w-3 h-3" /> {member.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-primary-muted text-primary border-primary/20">
                      {ROLE_LABELS[member.role]}
                    </span>
                    <select
                      className="input-light text-xs py-1.5"
                      value={member.role}
                      disabled={changingRoleId === member.id}
                      onChange={(e) => handleChangeRole(member.id, e.target.value as StaffRole)}
                    >
                      <option value="teacher">Teacher</option>
                      <option value="program_coordinator">Program Coordinator</option>
                      <option value="course_coordinator">Course Coordinator</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Teacher Requests */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-4 h-4 text-primary" />
            <h3 className="text-base font-bold text-text-primary">Teacher Access Requests</h3>
            {pendingRequests.length > 0 && (
              <span className="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold px-2 py-0.5 rounded-full">
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
                          className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          disabled={processingId === req.id}
                          className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </>
                    ) : (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                        req.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
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
      </main>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
};

export default AdminDashboard;
