/**
 * The single door every panel goes through to get rows.
 *
 * Two backends answer the same `query()` contract:
 *   - `live` talks to opendata.rdw.nl over the Socrata REST API;
 *   - `demo` evaluates the same SoQL against generated, RDW-shaped rows.
 *
 * Keeping one contract means a panel never knows which it is reading, and the
 * demo build exercises the real query paths rather than a parallel set of
 * hand-made fixtures.
 */

import { DATASETS, type DatasetKey } from '../data/datasets';
import { queryKey, toSearchParams, type SoqlQuery } from './soql';
import { runSoql, type Row } from '../mock/soqlEngine';
import { generateDemoData } from '../mock/generate';

export type SourceMode = 'live' | 'demo';

export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly dataset: DatasetKey,
    readonly status?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/**
 * Socrata rate-limits anonymous callers by IP and is generous to callers with
 * an app token. The token is not a secret - it identifies the app, not a user -
 * but it still belongs in the operator's environment rather than in the repo.
 */
const APP_TOKEN: string | undefined =
  (import.meta.env.VITE_RDW_APP_TOKEN as string | undefined) || undefined;

const MAX_CACHE_ENTRIES = 400;
const cache = new Map<string, Promise<Row[]>>();

function remember(key: string, promise: Promise<Row[]>): Promise<Row[]> {
  cache.set(key, promise);
  // A failed query must not be cached, or a transient blip becomes permanent.
  void promise.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return promise;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns a Socrata failure into something a panel can put on screen. */
function describeFailure(dataset: DatasetKey, status: number, body: string): DataSourceError {
  const spec = DATASETS[dataset];
  const detail = body.slice(0, 400);
  if (status === 404) {
    return new DataSourceError(
      `Dataset "${spec.name}" (${spec.id}) bestaat niet (meer).`,
      dataset,
      status,
      'Het resource-id kan gewijzigd zijn. Draai `npm run verify:datasets` om het tegen de live catalogus te controleren.',
    );
  }
  if (status === 400) {
    return new DataSourceError(
      `RDW wees de query op "${spec.name}" (${spec.id}) af.`,
      dataset,
      status,
      `Meestal een hernoemde kolom. ${detail}`,
    );
  }
  if (status === 403 || status === 429) {
    return new DataSourceError(
      'RDW beperkt het aantal verzoeken van deze client.',
      dataset,
      status,
      'Zet VITE_RDW_APP_TOKEN op een (gratis) Socrata app token om de anonieme limiet op te heffen.',
    );
  }
  return new DataSourceError(`RDW antwoordde met HTTP ${status}.`, dataset, status, detail);
}

async function fetchLive(dataset: DatasetKey, q: SoqlQuery, signal?: AbortSignal): Promise<Row[]> {
  const spec = DATASETS[dataset];
  const url = `https://opendata.rdw.nl/resource/${spec.id}.json?${toSearchParams(q).toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) headers['X-App-Token'] = APP_TOKEN;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, { headers, signal });
      if (response.ok) return (await response.json()) as Row[];

      const body = await response.text().catch(() => '');
      const failure = describeFailure(dataset, response.status, body);
      // 4xx other than throttling will not improve on a retry.
      if (response.status < 500 && response.status !== 429) throw failure;
      lastError = failure;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof DataSourceError && error.status && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new DataSourceError('RDW is niet bereikbaar.', dataset);
}

/* ------------------------------------------------------------- demo backend */

let demoTables: Record<DatasetKey, Row[]> | null = null;

function demoData(): Record<DatasetKey, Row[]> {
  if (!demoTables) {
    const generated = generateDemoData();
    demoTables = {
      vehicles: generated.vehicles as unknown as Row[],
      fuel: generated.fuel as unknown as Row[],
      body: generated.body as unknown as Row[],
      defectsFound: generated.defectsFound as unknown as Row[],
      defectCodes: generated.defectCodes as unknown as Row[],
      axles: generated.axles as unknown as Row[],
      vehicleClass: generated.vehicleClass as unknown as Row[],
      recallStatus: generated.recallStatus as unknown as Row[],
      recallAction: generated.recallAction as unknown as Row[],
      recallRisk: generated.recallRisk as unknown as Row[],
    };
  }
  return demoTables;
}

/** How many rows the demo fleet holds - shown so nobody reads it as national truth. */
export function demoFleetSize(): number {
  return demoData().vehicles.length;
}

async function fetchDemo(dataset: DatasetKey, q: SoqlQuery): Promise<Row[]> {
  // A beat of latency so loading and stale-hold states are exercised, not skipped.
  await sleep(40);
  return runSoql(demoData()[dataset], q);
}

/* ------------------------------------------------------------- public entry */

export interface QueryOptions {
  signal?: AbortSignal;
  /** Skip the cache - used by the "refresh" control. */
  fresh?: boolean;
}

/**
 * Runs one SoQL query against a dataset. Identical queries in flight at the
 * same time share a single request.
 */
export function query<T extends Row = Row>(
  mode: SourceMode,
  dataset: DatasetKey,
  q: SoqlQuery,
  options: QueryOptions = {},
): Promise<T[]> {
  const key = `${mode}:${queryKey(DATASETS[dataset].id, q)}`;
  if (options.fresh) cache.delete(key);
  const existing = cache.get(key);
  if (existing) return existing as Promise<T[]>;
  const promise = mode === 'demo' ? fetchDemo(dataset, q) : fetchLive(dataset, q, options.signal);
  return remember(key, promise) as Promise<T[]>;
}

/** A single aggregate value, the shape most stat tiles need. */
export async function scalar(
  mode: SourceMode,
  dataset: DatasetKey,
  q: SoqlQuery,
  field: string,
  options: QueryOptions = {},
): Promise<number | null> {
  const rows = await query(mode, dataset, q, options);
  const raw = rows[0]?.[field];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clearCache(): void {
  cache.clear();
}

/**
 * Probes the live API once. The app opens in live mode and falls back to demo
 * data if RDW is unreachable - from a blocked network, an outage, or a renamed
 * resource - rather than showing an empty dashboard.
 */
export async function probeLive(timeoutMs = 8000): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchLive('vehicles', { select: 'kenteken', limit: 1 }, controller.signal);
    return { ok: true };
  } catch (error) {
    const reason =
      error instanceof DataSourceError
        ? [error.message, error.hint].filter(Boolean).join(' ')
        : error instanceof Error && error.name === 'AbortError'
          ? 'RDW antwoordde niet binnen 8 seconden.'
          : 'De open-data API van de RDW is vanuit deze browser niet bereikbaar.';
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
