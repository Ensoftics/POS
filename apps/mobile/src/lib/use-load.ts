import { useCallback, useEffect, useState } from 'react';

export type LoadState<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

/** Runs an async loader on mount and on `reload()`, exposing loading/error/ready states. */
export function useLoad<T>(loader: () => Promise<T>): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loader().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (error: unknown) => !cancelled && setState({ status: 'error', error }),
    );
    return () => {
      cancelled = true;
    };
    // The loader is intentionally re-run only on mount and explicit reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return [state, reload];
}
