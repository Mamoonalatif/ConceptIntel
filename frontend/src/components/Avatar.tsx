// Purpose: shared user avatar; shows the uploaded profile photo (fetched with auth) or a fox-face placeholder.
import React, { useEffect, useState } from 'react';
import { API_URL } from '../services/api';

/** Single-color fox-face silhouette, drawn to match the stroke weight/viewBox
 *  convention of a lucide icon (24x24, currentColor) so it drops in wherever
 *  UserIcon used to - the app-wide "no photo yet" placeholder. */
const FoxFaceIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M4 3 L9 9 L4.5 9.5 Z" fill="currentColor" />
    <path d="M20 3 L15 9 L19.5 9.5 Z" fill="currentColor" />
    <path
      d="M12 21 C7 21 4.5 17.5 4.5 13.5 C4.5 9.8 7.8 7 12 7 C16.2 7 19.5 9.8 19.5 13.5 C19.5 17.5 17 21 12 21 Z"
      fill="currentColor"
    />
    <path d="M12 13.5 L8.7 19 L12 21 L15.3 19 Z" fill="#fff" opacity="0.9" />
    <circle cx="12" cy="15.2" r="1" fill="currentColor" opacity="0.7" />
  </svg>
);

// Avatar bytes are served behind auth (see backend GET /auth/users/{id}/avatar),
// not a public URL, so a plain <img src> won't work - fetch as a blob with the
// token attached, same approach as lib/download.ts, and cache the resulting
// object URL for this component instance's lifetime.
//
// `version` should be something that changes whenever the underlying photo
// does (the backend now returns a unique avatar_url per upload for exactly
// this reason) - it's appended as a cache-busting query param AND included in
// the effect's dependency array, so replacing a photo is reflected
// immediately instead of possibly showing a stale cached response (browser
// HTTP cache, an intermediate proxy, etc.) for a few minutes.
// Hook: downloads the user's avatar as an authenticated blob and returns a temporary object URL (or null if none).
// Re-runs when the user/photo version changes; the cleanup revokes the URL to free memory.
function useAvatarObjectUrl(userId: number | undefined, hasAvatar: boolean, version?: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !hasAvatar) {
      setObjectUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const cacheBust = version ? `?v=${encodeURIComponent(version)}` : '';
    fetch(`${API_URL}/auth/users/${userId}/avatar${cacheBust}`, {
      cache: 'no-store',
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
  }, [userId, hasAvatar, version]);

  return objectUrl;
}

// Props for Avatar: which user, whether they have a photo, a cache-busting version, and display size.
interface AvatarProps {
  userId?: number;
  hasAvatar?: boolean;
  /** The user's current avatar_url (or any value that changes when the photo
   *  changes) - used to cache-bust the fetch so a replaced/removed photo
   *  shows up immediately everywhere instead of possibly lagging behind. */
  version?: string | null;
  fullName?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Tailwind size classes for the avatar box at each size.
const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-20 h-20',
};

// Matching sizes for the placeholder fox icon.
const ICON_SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-9 h-9',
};

/**
 * Shared avatar: shows the user's uploaded profile photo if present, otherwise
 * the app's fox mascot face (not initials, not a generic human icon) on a flat
 * brand-color fill - matches the fox theme used across illustrations app-wide.
 */
export const Avatar: React.FC<AvatarProps> = ({ userId, hasAvatar = false, version, size = 'sm', className = '' }) => {
  const objectUrl = useAvatarObjectUrl(userId, hasAvatar, version);
  const sizeClass = SIZE_CLASSES[size];
  const iconSizeClass = ICON_SIZE_CLASSES[size];

  // A photo was loaded: show it; otherwise fall through to the placeholder below.
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
      <FoxFaceIcon className={`${iconSizeClass} text-white`} />
    </div>
  );
};

export default Avatar;
