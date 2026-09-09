/**
 * A small typed builder for SoQL, the query language Socrata exposes over the
 * RDW datasets. Everything the dashboard asks for is expressed here so that the
 * live client and the offline demo backend answer the exact same requests.
 */

export interface SoqlQuery {
  /** `$select` - projection, including aggregates such as `count(1) AS n`. */
  select?: string;
  /** `$where` - row filter. */
  where?: string;
  /** `$group` - grouping keys, comma separated. */
  group?: string;
  /** `$having` - filter applied after grouping. */
  having?: string;
  /** `$order` - e.g. `n DESC`. */
  order?: string;
  /** `$limit` - Socrata's page size. */
  limit?: number;
  /** `$offset` - Socrata's page offset. */
  offset?: number;
}

/** Serialises a query to the `$`-prefixed parameters Socrata expects. */
export function toSearchParams(q: SoqlQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (q.select) params.set('$select', q.select);
  if (q.where) params.set('$where', q.where);
  if (q.group) params.set('$group', q.group);
  if (q.having) params.set('$having', q.having);
  if (q.order) params.set('$order', q.order);
  if (q.limit != null) params.set('$limit', String(q.limit));
  if (q.offset != null) params.set('$offset', String(q.offset));
  return params;
}

/** A stable cache key: parameter order must not create two entries for one query. */
export function queryKey(datasetId: string, q: SoqlQuery): string {
  const params = toSearchParams(q);
  params.sort();
  return `${datasetId}?${params.toString()}`;
}

/* --- predicate helpers -------------------------------------------------- */

/** Escapes a value for a single-quoted SoQL string literal. */
export const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const eq = (field: string, value: string): string => `${field} = ${lit(value)}`;

export const notNull = (field: string): string => `${field} IS NOT NULL`;

export const gte = (field: string, value: number | string): string =>
  `${field} >= ${typeof value === 'number' ? value : lit(value)}`;

export const lte = (field: string, value: number | string): string =>
  `${field} <= ${typeof value === 'number' ? value : lit(value)}`;

export const between = (field: string, lo: number | string, hi: number | string): string =>
  `${gte(field, lo)} AND ${lte(field, hi)}`;

/** `field in ('A','B')`. Returns a never-true predicate for an empty list. */
export const inList = (field: string, values: readonly string[]): string =>
  values.length === 0 ? '1 = 0' : `${field} in (${values.map(lit).join(',')})`;

/** Joins predicates with AND, dropping empties. */
export const and = (...parts: (string | false | null | undefined)[]): string | undefined => {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (kept.length === 0) return undefined;
  return kept.map((p) => (kept.length > 1 ? `(${p})` : p)).join(' AND ');
};

/** A floating-timestamp bound, the shape RDW's `*_dt` columns use. */
export const ts = (isoDate: string): string => `${isoDate}T00:00:00.000`;
