import { useEffect, useRef } from 'react';

/**
 * Keeps a dashboard's data fresh without a manual page reload: refetches on an
 * interval, AND immediately whenever the tab/window regains focus (the case that
 * actually matters most - e.g. an admin sees a new teacher request the moment they
 * switch back to this tab, not up to `intervalMs` later).
 */
export function useAutoRefresh(fetchFn: () => void, intervalMs: number = 15000) {
  // Ref so the interval/listeners don't need to be torn down and recreated every
  // time the caller passes a fresh function reference on re-render.
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    const interval = setInterval(() => fetchRef.current(), intervalMs);

    const onFocus = () => fetchRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchRef.current();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
