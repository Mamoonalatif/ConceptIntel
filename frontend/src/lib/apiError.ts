// Turns an axios/network failure into a sentence worth showing a user.
//
// Most screens were catching errors with a bare `catch { setError('Failed to
// update concept.') }`, which threw away the reason the backend actually gave -
// FastAPI puts it in `detail`, and it's almost always the useful part ("You are
// not the assigned Course Coordinator for this revision's subject", "File
// exceeds the 25MB size limit"). This surfaces that when it exists, and falls
// back to a specific, non-alarming message per failure class when it doesn't.

// Minimal shape of an axios error that we rely on (avoids importing axios types).
interface ApiErrorLike {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
}

/** FastAPI returns `detail` as either a string or a list of validation objects
 *  ([{loc, msg, type}, ...]) - handle both rather than rendering "[object Object]". */
const readDetail = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const detail = (data as Record<string, unknown>).detail;

  if (typeof detail === 'string' && detail.trim()) return detail.trim();

  if (Array.isArray(detail)) {
    const messages = detail
      .map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>).msg : null))
      .filter((msg): msg is string => typeof msg === 'string' && msg.trim().length > 0);
    if (messages.length) return messages.join('. ');
  }

  // Some handlers return {message: "..."} instead.
  const message = (data as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim() ? message.trim() : null;
};

/**
 * Main export: converts any caught error into a user-friendly message.
 * Order: client-side failures (timeout/network) -> server `detail` -> per-status text.
 * @param error    whatever landed in the catch block
 * @param fallback what to say when the server gave no usable reason - write this
 *                 as the action that failed, e.g. "Could not save the concept."
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const err = error as ApiErrorLike;

  // Client-side failures never reached the server, so there's no `detail` to read
  // and the status-based messages below would be misleading.
  if (err?.code === 'ECONNABORTED') {
    return 'The server took too long to respond. It may still be working - wait a moment and refresh before trying again.';
  }
  if (err?.code === 'ERR_NETWORK' || !err?.response) {
    return "Can't reach the server. Check that the backend is running, then try again.";
  }

  const detail = readDetail(err.response.data);
  if (detail) return detail;

  switch (err.response.status) {
    case 400: return `${fallback} The details sent were rejected as invalid.`;
    case 401: return 'Your session has expired. Please sign in again.';
    case 403: return "You don't have permission to do that.";
    case 404: return `${fallback} It may have already been deleted by someone else.`;
    case 409: return `${fallback} It conflicts with a change someone else just made - refresh and try again.`;
    case 413: return `${fallback} The file is too large.`;
    case 422: return `${fallback} Some fields were missing or in the wrong format.`;
    case 429: return 'Too many requests in a short time. Please wait a moment and try again.';
    case 503: return 'That service is temporarily unavailable. Please try again shortly.';
    default:
      if ((err.response.status ?? 0) >= 500) {
        return `${fallback} The server hit an unexpected error - if it keeps happening, check the backend logs.`;
      }
      return fallback;
  }
}
