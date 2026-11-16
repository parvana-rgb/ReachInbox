import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api';

/**
 * Loads data and (optionally) refreshes it quietly every `pollMs`.
 * `loading` is only true for the first load of a given dependency set, so tables don't flash while polling.
 */
export function useRemote<T>(fetcher: () => Promise<T>, deps: unknown[], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const run = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try { setData(await fetchRef.current()); setError(null); }
    catch (e) { if (!silent) setError(errorMessage(e)); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => {
    let alive = true;
    void run(false);
    const id = pollMs ? window.setInterval(() => { if (alive && !document.hidden) void run(true); }, pollMs) : undefined;
    return () => { alive = false; if (id) window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, run]);

  return { data, error, loading, reload: () => run(false) };
}
