import { useEffect, useRef } from 'react';
import { clearApiCache } from '../services/api';

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
    // Drop the GET cache first: this hook exists precisely to go and look for
    // NEW server state, so serving it a memoized response would defeat it. The
    // cache still covers the case it's there for - navigating back to a screen
    // you just came from - because that path doesn't run this.
    const refresh = () => {
      clearApiCache();
      fetchRef.current();
    };

    const interval = setInterval(refresh, intervalMs);

    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
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
