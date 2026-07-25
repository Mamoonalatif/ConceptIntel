import React, { useEffect, useState } from 'react';
import { User as UserIcon } from 'lucide-react';

const API_URL = 'http://localhost:8000/api';

// Avatar bytes are served behind auth (see backend GET /auth/users/{id}/avatar),
// not a public URL, so a plain <img src> won't work - fetch as a blob with the
// token attached, same approach as lib/download.ts, and cache the resulting
// object URL for this component instance's lifetime.
function useAvatarObjectUrl(userId: number | undefined, hasAvatar: boolean): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !hasAvatar) {
      setObjectUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    fetch(`${API_URL}/auth/users/${userId}/avatar`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('no avatar'))))
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [userId, hasAvatar]);

  return objectUrl;
}

interface AvatarProps {
  userId?: number;
  hasAvatar?: boolean;
  fullName?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-20 h-20',
};

const ICON_SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-9 h-9',
};

/**
 * Shared avatar: shows the user's uploaded profile photo if present, otherwise
 * a plain human icon (not initials) on a flat brand-color fill.
 */
export const Avatar: React.FC<AvatarProps> = ({ userId, hasAvatar = false, size = 'sm', className = '' }) => {
  const objectUrl = useAvatarObjectUrl(userId, hasAvatar);
  const sizeClass = SIZE_CLASSES[size];
  const iconSizeClass = ICON_SIZE_CLASSES[size];

  if (objectUrl) {
    return (
      <img
        src={objectUrl}
        alt="Profile"
        className={`${sizeClass} rounded-lg object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-lg bg-primary flex items-center justify-center shrink-0 ${className}`}
    >
      <UserIcon className={`${iconSizeClass} text-white`} />
    </div>
  );
};

export default Avatar;
