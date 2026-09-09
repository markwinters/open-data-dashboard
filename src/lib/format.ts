/** Formatting helpers. The dashboard reads Dutch data, so numbers use nl-NL. */

const nf = new Intl.NumberFormat('nl-NL');
const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct1 = new Intl.NumberFormat('nl-NL', { style: 'percent', maximumFractionDigits: 1 });

export const num = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '–' : nf.format(Math.round(value));

export const num1 = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '–' : nf1.format(value);

/** Share of one, as a percentage: 0.062 -> "6,2%". */
export const percent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '–' : pct1.format(value);

/** Auto-compacted, for stat tiles and axis ticks: 1.284 / 12,9 mln. */
export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${nf1.format(value / 1e9)} mrd`;
  if (abs >= 1e6) return `${nf1.format(value / 1e6)} mln`;
  if (abs >= 10_000) return `${nf.format(Math.round(value / 1000))}K`;
  return nf.format(Math.round(value));
}

export const euro = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '–' : `€ ${nf.format(Math.round(value))}`;

/** Axis ticks want short, clean numbers without the unit. */
export function tick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${nf1.format(value / 1e6)}M`;
  if (abs >= 1000) return `${nf.format(value / 1000)}K`;
  return nf.format(value);
}

/**
 * RDW stores plates unpunctuated. Dutch plates are grouped in threes by
 * "sidecode": which grouping applies follows the pattern of letters and digits.
 */
export function plate(raw: string | null | undefined): string {
  if (!raw) return '–';
  const value = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (value.length !== 6) return value;
  const shape = value.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'D');
  const groupings: Record<string, [number, number]> = {
    DDLLDD: [2, 4], // sidecode 6 example - split into three pairs
    LLDDLL: [2, 4],
    DDLLLD: [2, 5],
    DLLLDD: [1, 4],
    LLDDDL: [2, 5],
    LDDDLL: [1, 4],
    LLLDDL: [3, 5],
    LDDLLL: [1, 3],
    DDDLLL: [3, 5],
    LLLDDD: [3, 5],
    DDLLLL: [2, 4],
    LLLLDD: [2, 4],
  };
  const cut = groupings[shape] ?? [2, 4];
  return `${value.slice(0, cut[0])}-${value.slice(cut[0], cut[1])}-${value.slice(cut[1])}`;
}

/** RDW timestamps are floating ISO strings: `2021-06-04T00:00:00.000`. */
export function shortDate(raw: string | null | undefined): string {
  if (!raw) return '–';
  const iso = String(raw).slice(0, 10);
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export const year = (raw: string | null | undefined): number | null => {
  if (!raw) return null;
  const y = Number(String(raw).slice(0, 4));
  return Number.isFinite(y) ? y : null;
};

/** Turns RDW's SHOUTED code-list values into something readable. */
export function titleCase(raw: string | null | undefined): string {
  if (!raw) return '–';
  const value = String(raw).trim();
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Parses RDW's numeric-as-string columns. */
export function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
