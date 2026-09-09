import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASETS } from '../data/datasets';
import { loadPassport } from '../data/queries';
import { clearCache } from '../lib/dataSource';

afterEach(() => {
  clearCache();
  vi.unstubAllGlobals();
});

/**
 * `loadPassport` and `loadCohort` degrade around a detail table that fails: the
 * panel says the dataset did not answer, and the rest of the view still draws.
 * That behaviour must not extend to a cancelled request - a load being replaced
 * is not a dataset that is missing, and rendering it as one is how a working
 * dashboard ends up full of empty panels.
 */
describe('a cancelled load', () => {
  it('is not reported as a missing dataset', async () => {
    // Resolves once the detail tables have actually been requested, so the
    // abort lands where the loader degrades rather than on the first query.
    let detailRequested: () => void;
    const detailInFlight = new Promise<void>((resolve) => {
      detailRequested = resolve;
    });

    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      // The vehicle spine answers; every detail table hangs until aborted.
      if (url.includes(DATASETS.vehicles.id)) {
        return Promise.resolve(new Response('[{"kenteken":"AA00BB"}]', { status: 200 }));
      }
      detailRequested();
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      });
    });

    const controller = new AbortController();
    const passport = loadPassport({ mode: 'live', signal: controller.signal }, 'AA-00-BB');
    await detailInFlight;
    controller.abort();

    await expect(passport).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still degrades around a detail table that genuinely fails', async () => {
    vi.stubGlobal('fetch', (url: string) => {
      if (url.includes(DATASETS.vehicles.id)) {
        return Promise.resolve(new Response('[{"kenteken":"AA00BB"}]', { status: 200 }));
      }
      if (url.includes(DATASETS.fuel.id)) {
        return Promise.resolve(new Response('gone', { status: 404 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const passport = await loadPassport({ mode: 'live' }, 'AA-00-BB');
    expect(passport?.missing).toEqual(['brandstof']);
    expect(passport?.vehicle.kenteken).toBe('AA00BB');
  });
});
