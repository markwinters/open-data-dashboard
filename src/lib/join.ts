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
/** Rows fetched per request while paging one batch of plates. */
const ROWS_PER_PAGE = 5000;
/**
 * A defensive ceiling on pages per batch. Reaching it would mean ~275 detail
 * rows for every plate in the batch, which no RDW detail table produces - so it
 * indicates something is wrong rather than a large-but-real result, and it is
 * reported rather than silently swallowed.
 */
const MAX_PAGES_PER_BATCH = 10;

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
    const base: SoqlQuery = {
      where: options.where
        ? `${inList(keyField, batch)} AND (${options.where})`
        : inList(keyField, batch),
    };
    if (options.select) base.select = options.select;

    // How many rows a batch of plates yields is not knowable in advance: a
    // vehicle has one fuel row or two, but it can carry dozens of inspection
    // defects. A fixed ceiling would silently drop the tail and quietly
    // undercount, so each batch is paged until a short page ends it.
    const rows: Row[] = [];
    for (let page = 0; page < MAX_PAGES_PER_BATCH; page++) {
      const chunkRows = await query(
        mode,
        dataset,
        { ...base, limit: ROWS_PER_PAGE, offset: page * ROWS_PER_PAGE },
        { signal: options.signal },
      );
      rows.push(...chunkRows);
      if (chunkRows.length < ROWS_PER_PAGE) return rows;
    }
    console.warn(
      `hydrate(${dataset}): batch of ${batch.length} keys still returning full pages after ` +
        `${MAX_PAGES_PER_BATCH} - results may be incomplete.`,
    );
    return rows;
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
