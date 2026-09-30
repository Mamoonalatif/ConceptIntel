import React, { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';
import { Avatar } from './Avatar';

interface ProfilePhotoEditorProps {
  size?: 'sm' | 'md' | 'lg';
  /** Camera-button badge diameter in px. Defaults to a size that fits a 'lg' avatar. */
  badgeSizePx?: number;
  onError?: (message: string) => void;
}

/**
 * Shared "click the avatar to change your photo" control, used on both
 * ProfilePage and SettingsPage so every profile-photo surface stays wired to
 * the same upload/refresh logic instead of drifting out of sync (this is
 * also why both pages must render the shared `Avatar` component rather than
 * their own initials-only markup - otherwise a freshly uploaded photo only
 * shows up on whichever page did the upload, not everywhere else, since
 * `Avatar` is what actually reads `user.avatar_url` from AuthContext).
 */
export const ProfilePhotoEditor: React.FC<ProfilePhotoEditorProps> = ({ size = 'lg', badgeSizePx = 28, onError }) => {
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await authService.uploadAvatar(file);
      await refreshUser();
    } catch (err: any) {
      onError?.(apiErrorMessage(err, 'Failed to upload photo.'));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="relative shrink-0 group">
      <Avatar userId={user.id} hasAvatar={!!user.avatar_url} version={user.avatar_url} fullName={user.full_name} size={size} />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        title="Change photo"
        className="absolute -bottom-1 -right-1 rounded-full bg-primary text-white flex items-center justify-center shadow-card border-2 border-surface hover:bg-primary-hover transition-all disabled:opacity-60"
        style={{ width: badgeSizePx, height: badgeSizePx }}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
    </div>
  );
};

export default ProfilePhotoEditor;
