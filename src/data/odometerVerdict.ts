import type { StatusLevel } from '../lib/palette';

/**
 * RDW's verdict on a vehicle's odometer history.
 *
 * The register records every reading handed in at a garage or inspection and
 * judges whether the sequence is plausible. It publishes three things: the year
 * of the last reading, the verdict itself, and - when it cannot reach a verdict -
 * a code saying why. It does not publish the reading, so there is no mileage
 * figure here, only whether the series holds up.
 *
 * The code list is small, fixed and statutory in character. The dashboard swaps
 * the list for RDW's own published explanation table (`jqs4-4kvw`) whenever it
 * is reachable - this map is now the fallback for a passport whose lexicon
 * request failed, not the primary source.
 */
export const ODOMETER_REASONS: Record<string, string> = {
  '00': 'Elke geregistreerde stand lag hoger dan de vorige. De reeks is logisch verklaarbaar.',
  '01':
    'De teller loopt niet door tot 999.999 of is na het maximum teruggesprongen naar nul, ' +
    'dus de RDW geeft geen oordeel.',
  '02':
    'De teller is vervangen of gerepareerd, waardoor onduidelijk is hoeveel het voertuig ' +
    'werkelijk heeft gereden. De RDW geeft geen oordeel.',
  '04':
    'Er is een stand geregistreerd die lager lag dan de vorige — mogelijk teruggedraaid of ' +
    'een tikfout. De RDW baseert dit oordeel op metingen vanaf 1 januari 2014.',
};

export interface OdometerVerdict {
  /** RDW's own wording, passed through unchanged. */
  verdict: string | null;
  /** Year of the most recent registered reading. */
  year: number | null;
  /** The statutory reason, when RDW could not judge the sequence. */
  reason: string | null;
  /** Whether this should light a lamp, and how hard. */
  level: StatusLevel;
  lit: boolean;
}

/**
 * Reads the three register columns into one verdict.
 *
 * "Onlogisch" is the one that matters: it means a reading came in lower than
 * the one before it, which is what odometer tampering looks like from the
 * outside. It lights red. An absent verdict is not a warning - plenty of
 * vehicles simply have too few readings - so it stays dark.
 */
export function readOdometerVerdict(
  verdictRaw: string | null,
  yearRaw: string | null,
  reasonCode: string | null,
  reasons?: ReadonlyMap<string, string> | null,
): OdometerVerdict {
  const verdict = verdictRaw?.trim() || null;
  const year = yearRaw ? Number(yearRaw) : null;
  const code = reasonCode ? reasonCode.padStart(2, '0') : null;
  // The live lexicon wins when it answered; the bundled list is the fallback.
  const reason = code ? (reasons?.get(code) ?? ODOMETER_REASONS[code] ?? null) : null;

  const normalised = verdict?.toLowerCase() ?? '';
  if (normalised.includes('onlogisch')) {
    return { verdict, year: Number.isFinite(year) ? year : null, reason, level: 'critical', lit: true };
  }
  if (normalised.includes('logisch')) {
    return { verdict, year: Number.isFinite(year) ? year : null, reason, level: 'good', lit: false };
  }
  // No verdict: worth showing, not worth alarming about.
  return { verdict, year: Number.isFinite(year) ? year : null, reason, level: 'warning', lit: false };
}
