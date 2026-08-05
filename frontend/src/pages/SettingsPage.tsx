import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, type NavItem } from '../components/AppShell';
import { useAuth } from '../context/AuthContext';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { ProfilePhotoEditor } from '../components/ProfilePhotoEditor';
import { notificationPreferencesService, type NotificationPreferences } from '../services/api';
import { ArrowLeft, Settings, RefreshCw, AlertCircle, KeyRound, Mail } from 'lucide-react';

/* Accessible pill toggle switch, styled with the app's theme tokens.
   Plain checkbox under the hood (keyboard/screen-reader friendly) with the
   track/thumb painted via a peer-checked sibling instead of native appearance. */
const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}> = ({ checked, onChange, disabled, label }) => (
  <label className={`relative inline-flex items-center shrink-0 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
    <input
      type="checkbox"
      className="sr-only peer"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
    <div
      className="w-11 h-6 rounded-full border transition-colors duration-200 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
      style={{
        backgroundColor: checked ? 'rgb(var(--primary))' : 'rgb(var(--border))',
        borderColor: checked ? 'rgb(var(--primary))' : 'rgb(var(--border))',
        outlineColor: 'rgb(var(--primary-light))',
      }}
    >
      <div
        className="w-4.5 h-4.5 bg-white rounded-full shadow-sm transition-transform duration-200 mt-[2.5px]"
        style={{ transform: checked ? 'translateX(22px)' : 'translateX(3px)' }}
      />
    </div>
  </label>
);

/* One preference row: title + description on the left, toggle on the right.
   Field metadata (label/description) is written from
   backend/app/notifications/service.py's NOTIFICATION_TYPE_TO_PREFERENCE_FIELD
   mapping, so each description reflects exactly what that column gates. */
const PREFERENCE_FIELDS: { key: keyof NotificationPreferences; title: string; description: string }[] = [
  {
    key: 'course_posts',
    title: 'Class posts',
    description: 'Announcements, new materials, and meeting links posted in your courses.',
  },
  {
    key: 'assignment_updates',
    title: 'New assignments',
    description: 'When a teacher posts a new assignment in one of your courses.',
  },
  {
    key: 'grading_updates',
    title: 'Assignment submissions',
    description: 'When a student submits an assignment in a course you teach.',
  },
  {
    key: 'enrollment_updates',
    title: 'Enrollment updates',
    description: 'When you join a course, or a new student enrolls in a course you teach.',
  },
  {
    key: 'content_processing_updates',
    title: 'Content processing',
    description: 'When uploaded course materials finish processing, or a knowledge graph is approved or rejected.',
  },
  {
    key: 'system_updates',
    title: 'System & account',
    description: 'Teacher access request outcomes and account approval notifications.',
  },
];

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await notificationPreferencesService.get();
        if (!cancelled) setPrefs(data);
      } catch {
        if (!cancelled) setError('Could not load your notification preferences. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (key: keyof NotificationPreferences, next: boolean) => {
    if (!prefs) return;
    const previous = prefs;
    // Optimistic update - flip immediately, PATCH in the background, revert on failure.
    setPrefs({ ...prefs, [key]: next });
    setSavingKey(key);
    setError('');
    try {
      const updated = await notificationPreferencesService.update({ [key]: next });
      setPrefs(updated);
    } catch {
      setPrefs(previous);
      setError('Could not save that change. Please try again.');
    } finally {
      setSavingKey(null);
    }
  };

  const navItems: NavItem[] = [
    { key: 'back', label: 'Back to Dashboard', icon: ArrowLeft, onClick: () => navigate(-1) },
  ];

  return (
    <AppShell roleLabel="Settings" logoIcon={Settings} navItems={navItems}>
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-text-secondary mt-1 text-sm">Manage your profile and notification preferences.</p>
        </div>

        {/* Profile summary */}
        {user && (
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
            <h2 className="text-base font-bold text-text-primary mb-4">Profile</h2>
            {photoError && (
              <div className="flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg px-3 py-2 mb-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {photoError}
              </div>
            )}
            <div className="flex items-center gap-4">
              <ProfilePhotoEditor size="md" badgeSizePx={20} onError={setPhotoError} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary truncate">{user.full_name}</p>
                <p className="text-xs text-text-secondary flex items-center gap-1.5 mt-0.5 truncate">
                  <Mail className="w-3 h-3 shrink-0" /> {user.email}
                </p>
              </div>
              <button onClick={() => navigate('/profile')} className="btn-ghost text-xs shrink-0">
                View full profile
              </button>
            </div>
            <button
              onClick={() => setShowChangePassword(true)}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary dark:text-primary-light hover:underline"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Change password
            </button>
          </div>
        )}

        {/* Email notifications */}
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <h2 className="text-base font-bold text-text-primary mb-1">Email notifications</h2>
          <p className="text-xs text-text-secondary mb-4">
            Choose which activity you'd like to be notified about. These apply to notifications shown in the app.
          </p>

          {error && (
            <div className="flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg px-3 py-2 mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-sm text-text-muted">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading preferences...
            </div>
          ) : !prefs ? null : (
            <div className="divide-y divide-border">
              {PREFERENCE_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{field.title}</p>
                    <p className="text-xs text-text-secondary mt-0.5">{field.description}</p>
                  </div>
                  <ToggleSwitch
                    checked={prefs[field.key]}
                    disabled={savingKey === field.key}
                    label={field.title}
                    onChange={(next) => handleToggle(field.key, next)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </AppShell>
  );
};

export default SettingsPage;
