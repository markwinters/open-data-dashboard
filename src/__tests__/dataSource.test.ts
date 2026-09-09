import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache, query } from '../lib/dataSource';

interface Pending {
  resolve: (rows: unknown[]) => void;
  aborted: boolean;
}

/**
 * A fetch that never settles on its own, so a test can decide exactly when a
 * request completes - and can see whether an abort reached the network at all.
 */
function stubFetch(): { calls: Pending[] } {
  const calls: Pending[] = [];
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    const pending: Pending = { resolve: () => {}, aborted: false };
    calls.push(pending);
    return new Promise((resolve, reject) => {
      pending.resolve = (rows) =>
        resolve(new Response(JSON.stringify(rows), { status: 200 }));
      init.signal?.addEventListener('abort', () => {
        pending.aborted = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  });
  return { calls };
}

const Q = { select: 'kenteken', limit: 1 } as const;

afterEach(() => {
  clearCache();
  vi.unstubAllGlobals();
});

describe('the shared request cache', () => {
  it('serves two callers of the same query from one request', async () => {
    const { calls } = stubFetch();
    const a = query('live', 'vehicles', Q, { signal: new AbortController().signal });
    const b = query('live', 'vehicles', Q, { signal: new AbortController().signal });

    expect(calls).toHaveLength(1);
    calls[0]!.resolve([{ kenteken: 'AA00BB' }]);
    await expect(a).resolves.toEqual([{ kenteken: 'AA00BB' }]);
    await expect(b).resolves.toEqual([{ kenteken: 'AA00BB' }]);
  });

  /**
   * The regression this file exists for. React re-runs an effect - on a
   * StrictMode remount, a tab switch, a changed filter - by aborting the old
   * signal and immediately asking again. If that abort travelled into the
   * shared request, the new caller inherited it and every panel rendered
   * "The operation was aborted." instead of data.
   */
  it('does not hand one caller abort to another caller of the same query', async () => {
    const { calls } = stubFetch();
    const first = new AbortController();
    const dropped = query('live', 'vehicles', Q, { signal: first.signal });
    void dropped.catch(() => {});

    first.abort();

    const second = new AbortController();
    const kept = query('live', 'vehicles', Q, { signal: second.signal });

    // Nobody was waiting when the first caller left, so its request was
    // cancelled and the second caller started a live one of its own.
    expect(calls[0]!.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve([{ kenteken: 'AA00BB' }]);
    await expect(kept).resolves.toEqual([{ kenteken: 'AA00BB' }]);
  });

  it('keeps the request alive while another caller is still waiting', async () => {
    const { calls } = stubFetch();
    const leaving = new AbortController();
    const staying = new AbortController();
    const abandoned = query('live', 'vehicles', Q, { signal: leaving.signal });
    void abandoned.catch(() => {});
    const kept = query('live', 'vehicles', Q, { signal: staying.signal });

    leaving.abort();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.aborted).toBe(false);
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });

    calls[0]!.resolve([{ kenteken: 'AA00BB' }]);
    await expect(kept).resolves.toEqual([{ kenteken: 'AA00BB' }]);
  });

  it('cancels the request once the last caller has walked away', async () => {
    const { calls } = stubFetch();
    const a = new AbortController();
    const b = new AbortController();
    void query('live', 'vehicles', Q, { signal: a.signal }).catch(() => {});
    void query('live', 'vehicles', Q, { signal: b.signal }).catch(() => {});

    a.abort();
    expect(calls[0]!.aborted).toBe(false);
    b.abort();
    expect(calls[0]!.aborted).toBe(true);
  });

  it('rejects a caller whose signal was already aborted, without touching the request', async () => {
    const { calls } = stubFetch();
    const live = new AbortController();
    const kept = query('live', 'vehicles', Q, { signal: live.signal });

    const stale = AbortSignal.abort();
    await expect(query('live', 'vehicles', Q, { signal: stale })).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(calls[0]!.aborted).toBe(false);
    calls[0]!.resolve([{ kenteken: 'AA00BB' }]);
    await expect(kept).resolves.toEqual([{ kenteken: 'AA00BB' }]);
  });

  it('replays a completed query from cache without a second request', async () => {
    const { calls } = stubFetch();
    const first = query('live', 'vehicles', Q, { signal: new AbortController().signal });
    calls[0]!.resolve([{ kenteken: 'AA00BB' }]);
    await first;

    const again = query('live', 'vehicles', Q, { signal: new AbortController().signal });
    expect(calls).toHaveLength(1);
    await expect(again).resolves.toEqual([{ kenteken: 'AA00BB' }]);
  });

  it('does not cache a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(query('live', 'vehicles', Q)).rejects.toMatchObject({ status: 404 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    await expect(query('live', 'vehicles', Q)).resolves.toEqual([]);
  });

  it('starts a fresh request when the caller asks to skip the cache', async () => {
    const { calls } = stubFetch();
    const first = query('live', 'vehicles', Q);
    calls[0]!.resolve([{ kenteken: 'AA00BB' }]);
    await first;

    void query('live', 'vehicles', Q, { fresh: true }).catch(() => {});
    expect(calls).toHaveLength(2);
  });
});
