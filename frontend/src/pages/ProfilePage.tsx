import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AppShell, type NavItem } from '../components/AppShell';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { Avatar } from '../components/Avatar';
import { StudyIllustration, TeachIllustration } from '../components/illustrations';
import { authService } from '../services/api';
import { getPrimaryNavItems } from '../lib/roleNav';
import {
  User,
  Mail,
  Shield,
  GraduationCap,
  BookOpen,
  LayoutGrid,
  ShieldCheck,
  Database,
  KeyRound,
  Check,
  Camera,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ROLE_META: Record<string, { label: string; icon: React.FC<{ className?: string }>; desc: string; capabilities: string[] }> = {
  student: {
    label: 'Student',
    icon: GraduationCap,
    desc: 'Access enrolled courses, explore interactive concept graphs, and track your own learning progress.',
    capabilities: [
      'Access enrolled course materials',
      'Explore interactive concept graphs',
      'Complete adaptive quizzes & flashcards',
      'View AI-generated assignment feedback',
    ],
  },
  teacher: {
    label: 'Teacher',
    icon: BookOpen,
    desc: 'Manage your courses, curate concept graphs, and review student assignments.',
    capabilities: [
      'Upload syllabus & lecture materials',
      'Curate AI-extracted concept graphs',
      'Grade student assignments with AI assistance',
      'View class analytics and progress',
    ],
  },
  program_coordinator: {
    label: 'Program Coordinator',
    icon: ShieldCheck,
    desc: 'Oversee academic programs and student progression across courses.',
    capabilities: [
      'Manage programs and their courses',
      'Assign course coordinators',
      'Track student progression',
      'Review concept alignment across courses',
    ],
  },
  course_coordinator: {
    label: 'Course Coordinator',
    icon: LayoutGrid,
    desc: 'Maintain course templates and align syllabuses with institutional standards.',
    capabilities: [
      'Maintain course templates',
      'Align syllabuses with standards',
      'Coordinate with assigned teachers',
      'Review course-level concept graphs',
    ],
  },
  admin: {
    label: 'Administrator',
    icon: Database,
    desc: 'Full platform oversight, including user management and system configuration.',
    capabilities: [
      'Manage user roles & permissions',
      'Create and manage programs',
      'Approve teacher access requests',
      'Monitor platform health',
    ],
  },
};

/* Info Row */
const InfoRow: React.FC<{ label: string; value: string; icon: React.FC<{ className?: string }> }> = ({ label, value, icon: Icon }) => (
  <div className="flex items-center gap-4 p-4 bg-background border border-border rounded-xl">
    <div className="w-9 h-9 rounded-lg bg-primary-muted flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-primary dark:text-primary-light" />
    </div>
    <div className="min-w-0">
      <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-text-primary truncate">{value}</p>
    </div>
  </div>
);

const ProfilePage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setPhotoBusy(true);
    try {
      await authService.uploadAvatar(file);
      await refreshUser();
    } catch (err: any) {
      setPhotoError(err.response?.data?.detail || 'Failed to upload photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoError('');
    setPhotoBusy(true);
    try {
      await authService.deleteAvatar();
      await refreshUser();
    } catch (err: any) {
      setPhotoError(err.response?.data?.detail || 'Failed to remove photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  if (!user) return null;

  const role = user.role;
  const roleMeta = ROLE_META[role] ?? ROLE_META.student;
  const RoleIcon = roleMeta.icon;
  // Student-facing role gets the "studying" illustration; every staff-facing
  // role (teacher, both coordinators, admin) gets the "teaching" one.
  const Illustration = role === 'student' ? StudyIllustration : TeachIllustration;

  // Same role-specific top section as the user's own dashboard, so the sidebar
  // looks identical everywhere, plus "My Profile" as this page's own item.
  const navItems: NavItem[] = [
    ...getPrimaryNavItems(user, navigate),
    {
      key: 'profile',
      label: 'My Profile',
      icon: User,
      active: true,
    },
  ];

  return (
    <AppShell roleLabel={roleMeta.label} navItems={navItems}>
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">

        {/* Header */}
        <div className="glass-panel rounded-2xl border border-border shadow-card p-6 sm:p-8">
          <div className="flex flex-col-reverse sm:flex-row items-center sm:items-center gap-6">
            <div className="flex-1 w-full text-center sm:text-left">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4">
                <Avatar userId={user.id} hasAvatar={!!user.avatar_url} version={user.avatar_url} fullName={user.full_name} size="lg" className="shrink-0" />
                <div className="min-w-0">
                  <h1 className="text-xl font-extrabold text-text-primary truncate">{user.full_name}</h1>
                  <p className="text-sm text-text-secondary flex items-center justify-center sm:justify-start gap-1.5 mt-0.5">
                    <Mail className="w-3.5 h-3.5 shrink-0" /> {user.email}
                  </p>
                  <span className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-bold bg-primary text-white">
                    <RoleIcon className="w-3 h-3" />
                    {roleMeta.label}
                  </span>
                </div>
              </div>
            </div>
            <Illustration className="w-32 h-32 sm:w-36 sm:h-36 shrink-0" />
          </div>
        </div>

        {/* Details Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Account Information */}
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-primary dark:text-primary-light" />
              <h2 className="text-base font-bold text-text-primary">Account Information</h2>
            </div>
            <InfoRow label="Full Name" value={user.full_name} icon={User} />
            <InfoRow label="Email Address" value={user.email} icon={Mail} />
            <InfoRow label="Account Role" value={roleMeta.label} icon={Shield} />
            <InfoRow label="Account ID" value={`#${user.id}`} icon={Database} />
          </div>

          {/* Role Overview */}
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <RoleIcon className="w-4 h-4 text-primary dark:text-primary-light" />
              <h2 className="text-base font-bold text-text-primary">Role Overview</h2>
            </div>

            <div className="p-5 rounded-xl bg-primary text-white">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center shrink-0">
                  <RoleIcon className="w-4.5 h-4.5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold truncate">{roleMeta.label}</p>
                  <p className="text-white/70 text-xs">ConceptIntel Platform</p>
                </div>
              </div>
              <p className="text-sm text-white/90 leading-relaxed">{roleMeta.desc}</p>
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-bold text-text-muted uppercase tracking-wider">Capabilities</p>
              {roleMeta.capabilities.map(cap => (
                <div key={cap} className="flex items-center gap-2 text-xs text-text-secondary">
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" /> {cap}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Profile Photo Section */}
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <div className="flex items-center gap-2 mb-1">
            <Camera className="w-4 h-4 text-primary dark:text-primary-light" />
            <h2 className="text-base font-bold text-text-primary">Profile Photo</h2>
          </div>
          <p className="text-sm text-text-secondary mb-4">
            Upload a photo so teachers and students recognize you across the platform.
          </p>
          {photoError && <p className="text-sm text-rose-500 mb-3">{photoError}</p>}
          <div className="flex items-center gap-3">
            <button onClick={() => fileInputRef.current?.click()} disabled={photoBusy} className="btn-primary disabled:opacity-60">
              {photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {user.avatar_url ? 'Change Photo' : 'Upload Photo'}
            </button>
            {user.avatar_url && (
              <button onClick={handleRemovePhoto} disabled={photoBusy} className="btn-ghost text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-60">
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
          </div>
        </div>

        {/* Security Section */}
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-primary dark:text-primary-light" />
            <h2 className="text-base font-bold text-text-primary">Password & Security</h2>
          </div>
          <p className="text-sm text-text-secondary mb-4">
            Update your password to keep your account secure.
          </p>
          <button onClick={() => setShowChangePassword(true)} className="btn-primary">
            <KeyRound className="w-4 h-4" />
            Change Password
          </button>
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </AppShell>
  );
};

export default ProfilePage;
