import { useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  /** True on the very first load, when there is nothing to hold on screen. */
  loading: boolean;
  /** True while refetching with a previous result still rendered. */
  refreshing: boolean;
}

/**
 * Runs an async task keyed by `deps`, holding the previous result on screen
 * while the next one loads. Charts must never flash a skeleton on refetch - the
 * frame stays, the content dims - so `data` survives across dependency changes
 * and `refreshing` drives the dimming.
 */
export function useAsync<T>(
  task: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: true,
    refreshing: false,
  });
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setState((previous) => ({
      data: previous.data,
      error: null,
      loading: previous.data === null,
      refreshing: previous.data !== null,
    }));

    taskRef
      .current(controller.signal)
      .then((data) => {
        if (live) setState({ data, error: null, loading: false, refreshing: false });
      })
      .catch((error: unknown) => {
        if (!live || controller.signal.aborted) return;
        setState((previous) => ({
          data: previous.data,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
          refreshing: false,
        }));
      });

    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
