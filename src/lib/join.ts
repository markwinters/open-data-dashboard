/**
 * Client-side joins across RDW datasets.
 *
 * Socrata serves one dataset per request and has no server-side join, so the
 * connections that make this data interesting - a vehicle's emissions, its body,
 * its inspection history - have to be assembled here. The pattern is always the
 * same: take a cohort of licence plates from the vehicle register, then hydrate
 * it from the detail tables with chunked `kenteken in (...)` queries.
 *
 * The chunking matters. One request per vehicle would be thousands of requests;
 * one request for thousands of plates would exceed the URL limit. 180 plates per
 * request keeps the URL near 2 kB, and a small concurrency window keeps the
 * dashboard well inside RDW's rate limit.
 */

import { query, type SourceMode } from './dataSource';
import type { DatasetKey } from '../data/datasets';
import { inList, type SoqlQuery } from './soql';
import type { Row } from '../mock/soqlEngine';

const PLATES_PER_REQUEST = 180;
const CONCURRENCY = 4;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs tasks with a bounded number in flight, preserving result order. */
async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}

export interface HydrateOptions {
  /** Columns to project; omit for all. Keeping this tight makes joins much faster. */
  select?: string;
  /** Extra predicate ANDed with the plate filter. */
  where?: string;
  signal?: AbortSignal;
}

/**
 * Fetches every row of `dataset` whose join key is in `keys`, grouped by that
 * key. Detail tables are one-to-many - a plug-in hybrid has two fuel rows, a
 * vehicle has one defect row per defect - so the result is a Map of arrays.
 */
export async function hydrate(
  mode: SourceMode,
  dataset: DatasetKey,
  keyField: string,
  keys: readonly string[],
  options: HydrateOptions = {},
): Promise<Map<string, Row[]>> {
  const unique = [...new Set(keys.filter(Boolean))];
  const byKey = new Map<string, Row[]>();
  if (unique.length === 0) return byKey;

  const batches = chunk(unique, PLATES_PER_REQUEST);
  const tasks = batches.map((batch) => async () => {
    const q: SoqlQuery = {
      where: options.where
        ? `${inList(keyField, batch)} AND (${options.where})`
        : inList(keyField, batch),
      // A detail table can hold several rows per key; leave headroom for that.
      limit: batch.length * 12,
    };
    if (options.select) q.select = options.select;
    return query(mode, dataset, q, { signal: options.signal });
  });

  for (const rows of await pooled(tasks, CONCURRENCY)) {
    for (const row of rows) {
      const key = row[keyField];
      if (key == null) continue;
      const id = String(key);
      const bucket = byKey.get(id);
      if (bucket) bucket.push(row);
      else byKey.set(id, [row]);
    }
  }
  return byKey;
}

/** Pages a dataset past Socrata's per-request ceiling. */
export async function fetchPaged(
  mode: SourceMode,
  dataset: DatasetKey,
  base: SoqlQuery,
  total: number,
  signal?: AbortSignal,
): Promise<Row[]> {
  const pageSize = 5000;
  const pages = Math.ceil(total / pageSize);
  const tasks = Array.from({ length: pages }, (_, page) => async () =>
    query(mode, dataset, { ...base, limit: Math.min(pageSize, total - page * pageSize), offset: page * pageSize }, { signal }),
  );
  return (await pooled(tasks, CONCURRENCY)).flat();
}
