/**
 * Colour assignment.
 *
 * Two rules carry the weight here:
 *  1. Categorical hues are assigned in the palette's fixed slot order and never
 *     cycled. The order is the colourblind-safety mechanism - it was validated
 *     as an ordered list, so a 9th series is folded into "Overig", never given
 *     a generated hue.
 *  2. Colour follows the entity, not its rank. Diesel is slot 2 whether it is
 *     the largest bar or the smallest, so filtering never repaints the
 *     survivors.
 */

export const SERIES_SLOTS = 8;

/** CSS custom property for categorical slot `index` (0-based). */
export function seriesVar(index: number): string {
  return `var(--series-${Math.min(index, SERIES_SLOTS - 1) + 1})`;
}

/**
 * Forms that use the all-pairs pairlist - scatter, bubble - cap at three
 * series: past three the palette cannot clear the separation floors with every
 * pair on screen at once.
 */
export const ALL_PAIRS_SERIES_CAP = 3;

/** The blue sequential ramp, light to dark. Index 0 is nearest the surface. */
export const SEQUENTIAL_STEPS = [
  'var(--seq-100)',
  'var(--seq-150)',
  'var(--seq-200)',
  'var(--seq-250)',
  'var(--seq-300)',
  'var(--seq-350)',
  'var(--seq-400)',
  'var(--seq-450)',
  'var(--seq-500)',
  'var(--seq-550)',
  'var(--seq-600)',
  'var(--seq-650)',
  'var(--seq-700)',
] as const;

/** Maps a 0..1 magnitude onto the sequential ramp. */
export function sequential(t: number): string {
  if (!Number.isFinite(t)) return 'var(--seq-100)';
  const clamped = Math.min(1, Math.max(0, t));
  const index = Math.round(clamped * (SEQUENTIAL_STEPS.length - 1));
  return SEQUENTIAL_STEPS[index]!;
}

/* ------------------------------------------------- stable entity → hue maps */

/**
 * RDW's `brandstof_omschrijving` code list, pinned to slots. The order here is
 * the order the values appear across the fleet, most common first, so the
 * common series get the leading slots - but each value keeps its slot no matter
 * what the current filter shows.
 */
export const FUEL_ORDER = [
  'Benzine',
  'Diesel',
  'Elektriciteit',
  'LPG',
  'CNG',
  'Waterstof',
  'Alcohol',
] as const;

/**
 * Powertrain, derived per vehicle by folding its fuel rows together - a vehicle
 * with both a Benzine and an Elektriciteit row is a plug-in hybrid, which no
 * single RDW row states. This is the classification the joined views use.
 */
export const POWERTRAIN_ORDER = [
  'Benzine',
  'Diesel',
  'Elektrisch',
  'Plug-in hybride',
  'LPG',
  'Overig',
] as const;

export type Powertrain = (typeof POWERTRAIN_ORDER)[number];

const fixedSlot = <T extends string>(order: readonly T[]) => {
  const slots = new Map<string, number>(order.map((value, index) => [value, index]));
  return (value: string | null | undefined): string =>
    seriesVar(slots.get(String(value)) ?? order.length - 1);
};

export const fuelColour = fixedSlot(FUEL_ORDER);
export const powertrainColour = fixedSlot(POWERTRAIN_ORDER);

/** Folds a vehicle's fuel rows into one powertrain label. */
export function classifyPowertrain(fuels: readonly string[]): Powertrain {
  const set = new Set(fuels.map((f) => String(f)));
  const electric = set.has('Elektriciteit');
  const petrol = set.has('Benzine');
  const diesel = set.has('Diesel');
  if (electric && (petrol || diesel)) return 'Plug-in hybride';
  if (electric) return 'Elektrisch';
  if (set.has('LPG')) return 'LPG';
  if (diesel) return 'Diesel';
  if (petrol) return 'Benzine';
  return 'Overig';
}

/** Status tokens. Reserved for state - never reused as a series colour. */
export const STATUS = {
  good: 'var(--good)',
  warning: 'var(--warning)',
  serious: 'var(--serious)',
  critical: 'var(--critical)',
} as const;

export type StatusLevel = keyof typeof STATUS;
