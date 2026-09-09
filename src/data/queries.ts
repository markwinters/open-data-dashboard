/**
 * Every question the dashboard asks of RDW, in one place.
 *
 * Two shapes of question live here, and the difference matters:
 *
 *  - **Aggregates** (`overviewKpis`, `registrationsByYear`, ...) push the work
 *    to Socrata with `$group`, so a headline number is one request over the
 *    whole 16-million-row register rather than a download.
 *
 *  - **Cohorts** (`loadCohort`, `loadPassport`) pull a bounded set of licence
 *    plates and then stitch the detail tables onto them here. Socrata has no
 *    server-side join, so anything that connects emissions to mass, body type
 *    to powertrain, or inspection defects to vehicle age has to be assembled
 *    client-side. That join is the point of those views.
 */

import { isAbortError, query, scalar, type SourceMode } from '../lib/dataSource';
import { hydrate } from '../lib/join';
import { and, between, eq, inList, notNull } from '../lib/soql';
import { classifyPowertrain, type Powertrain } from '../lib/palette';
import { toNumber } from '../lib/format';
import type { Row } from '../mock/soqlEngine';

const str = (row: Row, field: string): string | null => {
  const v = row[field];
  return v === undefined || v === null || v === '' ? null : String(v);
};

const numberOf = (row: Row, field: string): number | null => toNumber(row[field]);

const YEAR_OF_ADMISSION = 'date_extract_y(datum_eerste_toelating_dt)';

interface Ctx {
  mode: SourceMode;
  signal?: AbortSignal;
}

const countWhere = (ctx: Ctx, where?: string): Promise<number | null> =>
  scalar(ctx.mode, 'vehicles', { select: 'count(1) AS n', ...(where ? { where } : {}) }, 'n', {
    signal: ctx.signal,
  });

/* ------------------------------------------------------------- fleet totals */

export interface OverviewKpis {
  total: number | null;
  passengerCars: number | null;
  openRecalls: number | null;
  uninsured: number | null;
  electricRows: number | null;
}

export async function overviewKpis(ctx: Ctx): Promise<OverviewKpis> {
  const [total, passengerCars, openRecalls, uninsured, electricRows] = await Promise.all([
    countWhere(ctx),
    countWhere(ctx, eq('voertuigsoort', 'Personenauto')),
    countWhere(ctx, eq('openstaande_terugroepactie_indicator', 'Ja')),
    countWhere(ctx, eq('wam_verzekerd', 'Nee')),
    scalar(
      ctx.mode,
      'fuel',
      { select: 'count(1) AS n', where: eq('brandstof_omschrijving', 'Elektriciteit') },
      'n',
      { signal: ctx.signal },
    ),
  ]);
  return { total, passengerCars, openRecalls, uninsured, electricRows };
}

export interface YearCount {
  year: number;
  count: number;
}

/** First admissions per year - the fleet's intake, straight from the register. */
export async function registrationsByYear(ctx: Ctx, from: number, to: number): Promise<YearCount[]> {
  const rows = await query(
    ctx.mode,
    'vehicles',
    {
      select: `${YEAR_OF_ADMISSION} AS jaar, count(1) AS n`,
      where: between(YEAR_OF_ADMISSION, from, to),
      group: YEAR_OF_ADMISSION,
      order: 'jaar',
      limit: 200,
    },
    { signal: ctx.signal },
  );
  return rows
    .map((row) => ({ year: Number(row.jaar), count: Number(row.n) }))
    .filter((d) => Number.isFinite(d.year) && Number.isFinite(d.count));
}

export interface LabelCount {
  label: string;
  count: number;
}

export async function topBrands(ctx: Ctx, limit = 12): Promise<LabelCount[]> {
  const rows = await query(
    ctx.mode,
    'vehicles',
    {
      select: 'merk, count(1) AS n',
      where: and(notNull('merk'), eq('voertuigsoort', 'Personenauto')),
      group: 'merk',
      order: 'n DESC',
      limit,
    },
    { signal: ctx.signal },
  );
  return rows.map((row) => ({ label: str(row, 'merk') ?? 'Onbekend', count: Number(row.n) }));
}

export async function vehicleTypeMix(ctx: Ctx): Promise<LabelCount[]> {
  const rows = await query(
    ctx.mode,
    'vehicles',
    {
      select: 'voertuigsoort, count(1) AS n',
      where: notNull('voertuigsoort'),
      group: 'voertuigsoort',
      order: 'n DESC',
      limit: 20,
    },
    { signal: ctx.signal },
  );
  return rows.map((row) => ({ label: str(row, 'voertuigsoort') ?? 'Onbekend', count: Number(row.n) }));
}

export async function fuelMix(ctx: Ctx): Promise<LabelCount[]> {
  const rows = await query(
    ctx.mode,
    'fuel',
    {
      select: 'brandstof_omschrijving, count(1) AS n',
      where: notNull('brandstof_omschrijving'),
      group: 'brandstof_omschrijving',
      order: 'n DESC',
      limit: 20,
    },
    { signal: ctx.signal },
  );
  return rows.map((row) => ({
    label: str(row, 'brandstof_omschrijving') ?? 'Onbekend',
    count: Number(row.n),
  }));
}

export interface TypeByPeriod {
  type: string;
  year: number;
  count: number;
}

/**
 * Vehicle type against admission year. Grouped on two keys in one request, then
 * bucketed into five-year bands here - Socrata has no integer division, and
 * banding client-side keeps it to a single round trip.
 */
export async function typeByPeriod(ctx: Ctx, from: number, to: number): Promise<TypeByPeriod[]> {
  const rows = await query(
    ctx.mode,
    'vehicles',
    {
      select: `voertuigsoort, ${YEAR_OF_ADMISSION} AS jaar, count(1) AS n`,
      where: and(notNull('voertuigsoort'), between(YEAR_OF_ADMISSION, from, to)),
      group: `voertuigsoort, ${YEAR_OF_ADMISSION}`,
      order: 'jaar',
      limit: 5000,
    },
    { signal: ctx.signal },
  );
  return rows
    .map((row) => ({
      type: str(row, 'voertuigsoort') ?? 'Onbekend',
      year: Number(row.jaar),
      count: Number(row.n),
    }))
    .filter((d) => Number.isFinite(d.year));
}

/* ------------------------------------------------------------------ cohorts */

export interface CohortFilters {
  /** `null` means every marque. */
  marque: string | null;
  yearFrom: number;
  yearTo: number;
  vehicleType: string;
  sampleSize: number;
}

export interface CohortVehicle {
  kenteken: string;
  merk: string;
  model: string;
  year: number | null;
  massEmpty: number | null;
  price: number | null;
  colour: string | null;
  bodyType: string | null;
  fuels: string[];
  powertrain: Powertrain;
  co2: number | null;
  powerKw: number | null;
  /** Defect codes recorded at inspections, most recent first. */
  defects: { code: string; date: string | null }[];
  recallOpen: boolean;
}

export interface Cohort {
  vehicles: CohortVehicle[];
  /** Code -> statutory description, from the defect lexicon. */
  defectNames: Map<string, string>;
  /** How many vehicles match the filter in full, before sampling. */
  matchingTotal: number | null;
  /** Datasets that answered, so the UI can say what a missing panel is missing. */
  degraded: string[];
}

const COHORT_COLUMNS = [
  'kenteken',
  'merk',
  'handelsbenaming',
  'eerste_kleur',
  'massa_ledig_voertuig',
  'catalogusprijs',
  'datum_eerste_toelating_dt',
  'openstaande_terugroepactie_indicator',
].join(', ');

function cohortWhere(filters: CohortFilters): string | undefined {
  return and(
    filters.marque ? eq('merk', filters.marque) : null,
    filters.vehicleType ? eq('voertuigsoort', filters.vehicleType) : null,
    between(YEAR_OF_ADMISSION, filters.yearFrom, filters.yearTo),
    notNull('massa_ledig_voertuig'),
  );
}

/**
 * Draws a cohort from the register and hydrates it from the detail tables.
 *
 * One request selects the plates; the rest fan out over chunked
 * `kenteken in (...)` queries. Optional datasets that fail are recorded in
 * `degraded` and leave their panel empty rather than taking the view down -
 * a renamed resource should cost one card, not the page.
 */
export async function loadCohort(ctx: Ctx, filters: CohortFilters): Promise<Cohort> {
  const where = cohortWhere(filters);

  const [baseRows, matchingTotal] = await Promise.all([
    query(
      ctx.mode,
      'vehicles',
      {
        select: COHORT_COLUMNS,
        ...(where ? { where } : {}),
        order: 'kenteken',
        limit: filters.sampleSize,
      },
      { signal: ctx.signal },
    ),
    countWhere(ctx, where),
  ]);

  const plates = baseRows.map((row) => String(row.kenteken)).filter(Boolean);
  const degraded: string[] = [];

  // A detail table that fails should cost its panel, not the whole view - but a
  // cancelled request is not a failure, and reporting it as a degraded dataset
  // would draw an empty panel over a load that is simply being replaced.
  const optional = async <T>(name: string, task: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await task;
    } catch (error) {
      if (isAbortError(error)) throw error;
      degraded.push(name);
      return fallback;
    }
  };

  const empty = new Map<string, Row[]>();
  const [fuelByPlate, bodyByPlate, defectsByPlate, lexicon] = await Promise.all([
    optional(
      'brandstof',
      hydrate(ctx.mode, 'fuel', 'kenteken', plates, {
        select: 'kenteken, brandstof_omschrijving, co2_uitstoot_gecombineerd, nettomaximumvermogen',
        signal: ctx.signal,
      }),
      empty,
    ),
    optional(
      'carrosserie',
      hydrate(ctx.mode, 'body', 'kenteken', plates, {
        select: 'kenteken, type_carrosserie_europese_omschrijving',
        signal: ctx.signal,
      }),
      empty,
    ),
    optional(
      'geconstateerde gebreken',
      hydrate(ctx.mode, 'defectsFound', 'kenteken', plates, {
        select: 'kenteken, gebrek_identificatie, meld_datum_door_keuringsinstantie_dt',
        signal: ctx.signal,
      }),
      empty,
    ),
    optional('gebreken', defectLexicon(ctx), new Map<string, string>()),
  ]);

  const vehicles: CohortVehicle[] = baseRows.map((row) => {
    const kenteken = String(row.kenteken);
    const fuelRows = fuelByPlate.get(kenteken) ?? [];
    const fuels = fuelRows.map((f) => str(f, 'brandstof_omschrijving') ?? '').filter(Boolean);

    // A vehicle's CO2 is the highest of its fuel rows: for a plug-in hybrid the
    // electric row reads 0, and taking the max keeps the combustion figure.
    const co2Values = fuelRows
      .map((f) => numberOf(f, 'co2_uitstoot_gecombineerd'))
      .filter((v): v is number => v != null);
    const powerValues = fuelRows
      .map((f) => numberOf(f, 'nettomaximumvermogen'))
      .filter((v): v is number => v != null);

    const defects = (defectsByPlate.get(kenteken) ?? [])
      .map((d) => ({
        code: str(d, 'gebrek_identificatie') ?? '',
        date: str(d, 'meld_datum_door_keuringsinstantie_dt'),
      }))
      .filter((d) => d.code)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    const admission = str(row, 'datum_eerste_toelating_dt');

    return {
      kenteken,
      merk: str(row, 'merk') ?? 'Onbekend',
      model: str(row, 'handelsbenaming') ?? '',
      year: admission ? Number(admission.slice(0, 4)) : null,
      massEmpty: numberOf(row, 'massa_ledig_voertuig'),
      price: numberOf(row, 'catalogusprijs'),
      colour: str(row, 'eerste_kleur'),
      bodyType: str(bodyByPlate.get(kenteken)?.[0] ?? {}, 'type_carrosserie_europese_omschrijving'),
      fuels,
      powertrain: classifyPowertrain(fuels),
      co2: co2Values.length > 0 ? Math.max(...co2Values) : null,
      powerKw: powerValues.length > 0 ? Math.max(...powerValues) : null,
      defects,
      recallOpen: str(row, 'openstaande_terugroepactie_indicator') === 'Ja',
    };
  });

  return { vehicles, defectNames: lexicon, matchingTotal, degraded };
}

/** The statutory defect list. Small and stable, so it is fetched whole once. */
export async function defectLexicon(ctx: Ctx): Promise<Map<string, string>> {
  const rows = await query(
    ctx.mode,
    'defectCodes',
    { select: 'gebrek_identificatie, gebrek_omschrijving', limit: 2000 },
    { signal: ctx.signal },
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const code = str(row, 'gebrek_identificatie');
    const text = str(row, 'gebrek_omschrijving');
    if (code && text) map.set(code, text);
  }
  return map;
}

/** The marques offered in the cohort filter, by fleet size. */
export async function marqueOptions(ctx: Ctx, limit = 40): Promise<string[]> {
  const rows = await topBrands(ctx, limit);
  return rows.map((row) => row.label);
}

/* ----------------------------------------------------------------- passport */

export interface PassportDefect {
  code: string;
  description: string;
  date: string | null;
}

export interface Passport {
  vehicle: Row;
  fuels: Row[];
  body: Row[];
  axles: Row[];
  vehicleClass: Row[];
  defects: PassportDefect[];
  powertrain: Powertrain;
  missing: string[];
}

/**
 * One licence plate, resolved across every dataset at once.
 *
 * This is the clearest case for joining client-side: the register knows the
 * vehicle, a second dataset knows its emissions, a third its body, a fourth
 * every defect an inspector ever recorded - and a fifth turns those defect
 * codes into sentences. None of them is useful alone.
 */
export async function loadPassport(ctx: Ctx, rawPlate: string): Promise<Passport | null> {
  const kenteken = rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (kenteken.length < 4) return null;

  const vehicleRows = await query(
    ctx.mode,
    'vehicles',
    { where: eq('kenteken', kenteken), limit: 1 },
    { signal: ctx.signal },
  );
  const vehicle = vehicleRows[0];
  if (!vehicle) return null;

  const missing: string[] = [];
  const side = async (name: string, task: Promise<Row[]>): Promise<Row[]> => {
    try {
      return await task;
    } catch (error) {
      // As in `loadCohort`: a cancelled request has not told us the dataset is
      // missing, so it must not be reported as one.
      if (isAbortError(error)) throw error;
      missing.push(name);
      return [];
    }
  };

  const plateFilter = { where: eq('kenteken', kenteken), limit: 60 };
  const [fuels, body, axles, vehicleClass, defectRows, lexicon] = await Promise.all([
    side('brandstof', query(ctx.mode, 'fuel', plateFilter, { signal: ctx.signal })),
    side('carrosserie', query(ctx.mode, 'body', plateFilter, { signal: ctx.signal })),
    side('assen', query(ctx.mode, 'axles', plateFilter, { signal: ctx.signal })),
    side('voertuigklasse', query(ctx.mode, 'vehicleClass', plateFilter, { signal: ctx.signal })),
    side(
      'geconstateerde gebreken',
      query(ctx.mode, 'defectsFound', { where: eq('kenteken', kenteken), limit: 300 }, { signal: ctx.signal }),
    ),
    defectLexicon(ctx).catch((error: unknown) => {
      if (isAbortError(error)) throw error;
      return new Map<string, string>();
    }),
  ]);

  const defects: PassportDefect[] = defectRows
    .map((row) => {
      const code = str(row, 'gebrek_identificatie') ?? '';
      return {
        code,
        description: lexicon.get(code) ?? 'Omschrijving niet beschikbaar',
        date: str(row, 'meld_datum_door_keuringsinstantie_dt'),
      };
    })
    .filter((d) => d.code)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  return {
    vehicle,
    fuels,
    body,
    axles,
    vehicleClass,
    defects,
    powertrain: classifyPowertrain(
      fuels.map((f) => str(f, 'brandstof_omschrijving') ?? '').filter(Boolean),
    ),
    missing,
  };
}

/** A handful of plates that exist, so the passport view is never a dead end. */
export async function samplePlates(ctx: Ctx, limit = 5): Promise<Row[]> {
  return query(
    ctx.mode,
    'vehicles',
    {
      select: 'kenteken, merk, handelsbenaming',
      where: and(
        inList('voertuigsoort', ['Personenauto']),
        between(YEAR_OF_ADMISSION, 2015, 2026),
        notNull('merk'),
      ),
      order: 'kenteken',
      limit,
    },
    { signal: ctx.signal },
  );
}
