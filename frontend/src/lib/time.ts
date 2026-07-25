// Backend timestamps are naive UTC (Postgres `now()` with no offset info) - the
// Date constructor treats a date-time string with no timezone suffix as LOCAL
// time, not UTC, which silently skews "time ago" by the viewer's UTC offset.
// Appending "Z" (only when no offset is already present) forces correct UTC parsing.
export function parseUtc(iso: string): Date {
  return new Date(/[Z+-]\d{2}:?\d{2}$|Z$/.test(iso) ? iso : `${iso}Z`);
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - parseUtc(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return parseUtc(iso).toLocaleDateString();
}
