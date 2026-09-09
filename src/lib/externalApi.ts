/**
 * Non-RDW external data sources.
 *
 * The RDW data lives on Socrata and goes through the SoQL query layer. These
 * sources are different: REST APIs, static GeoJSON, OData. They each have
 * their own shape, so they are fetched here rather than shoehorned into the
 * `query()` contract that expects SoQL.
 */

/* ------------------------------------------------------------------ Kooijmans */

/**
 * The Kooijmans vehicle API serves photos, brand logos and market values keyed
 * on a Dutch plate. It is not anonymous open data - the free tier returns 401
 * without an API key - so, like the RDW app token, the key lives in the
 * operator's environment rather than in the repo. Without a key nothing render:
 * the photo panel and the "huidige waarde" spec simply stay absent.
 */
export const KOOIJMANS_SITE = 'https://vehicles.kooijmans.nl';
const KOOIJMANS_BASE = KOOIJMANS_SITE;
const KOOIJMANS_TOKEN: string | undefined =
  (import.meta.env.VITE_KOOIJMANS_TOKEN as string | undefined) || undefined;

/**
 * Provenance descriptors for the three external (non-RDW) sources the
 * dashboard reads, so view footers can credit and link them like a dataset.
 * Kept here next to the fetchers that talk to them.
 */
export const EXTERNAL_SOURCES = {
  kooijmans: {
    label: 'Kooijmans voertuigdata',
    url: KOOIJMANS_SITE,
    license: 'commerciële API',
  },
  cbsStatLine: {
    label: 'CBS StatLine 85243NED',
    url: 'https://opendata.cbs.nl/ODataApi/OData/85243NED',
    license: 'CC-BY 4.0',
  },
  cbsEmissions: {
    label: 'CBS StatLine 85347NED',
    url: 'https://opendata.cbs.nl/ODataApi/OData/85347NED',
    license: 'CC-BY 4.0',
  },
  cbsFuelPrices: {
    label: 'CBS StatLine 84991NED',
    url: 'https://opendata.cbs.nl/ODataApi/OData/84991NED',
    license: 'CC-BY 4.0',
  },
  cbsRoadDeaths: {
    label: 'CBS StatLine 71936NED',
    url: 'https://opendata.cbs.nl/ODataApi/OData/71936NED',
    license: 'CC-BY 4.0',
  },
  dotNl: {
    label: 'DOT-NL laadpalen',
    url: 'https://opendata.ndw.nu/',
    license: 'CC-BY',
  },
  parking: {
    label: 'RDW open data · parkeren',
    url: 'https://opendata.rdw.nl/d/mz4f-59fw',
    license: 'CC0',
  },
} as const;

export interface KooijmansVehicle {
  LicensePlate: string;
  Make: string;
  Model: string;
  TypeDescriptionLong: string;
  BrandLogo: string;
  BrandLogoThumb: string;
  PhotoFront: string;
  PhotoFrontThumb: string;
  PhotoRear: string;
  PhotoRearThumb: string;
  PhotoInterior: string;
  PhotoInteriorThumb: string;
  PathLogo: string;
  PathPhoto: string;
  ConstructionYear: number;
  ConstructionMonth: number;
  RdwColor: string;
  RdwColor2: string;
  ConsumerPrice: number;
  CurrentValue: number;
  RdwEnergyLabel: string;
  SecuritySystemClass: string;
  Source: string;
}

let kooijmansCache = new Map<string, KooijmansVehicle | null>();

export async function fetchKooijmans(
  plate: string,
  signal?: AbortSignal,
): Promise<KooijmansVehicle | null> {
  const key = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cached = kooijmansCache.get(key);
  if (cached !== undefined) return cached;

  // Without an API key the endpoint is guaranteed to refuse; skip the call.
  if (!KOOIJMANS_TOKEN) {
    kooijmansCache.set(key, null);
    return null;
  }

  try {
    const response = await fetch(`${KOOIJMANS_BASE}/api/licenseplates/opendata/${key}`, {
      headers: { Accept: 'application/json', 'X-Api-Key': KOOIJMANS_TOKEN },
      signal,
    });
    if (!response.ok) {
      // A 401 is persistent, not a blip: remember it so we do not hammer the API.
      kooijmansCache.set(key, null);
      return null;
    }
    const data = (await response.json()) as KooijmansVehicle;
    kooijmansCache.set(key, data);
    return data;
  } catch {
    kooijmansCache.set(key, null);
    return null;
  }
}

/** Combines the API's path prefix and file name into a URL. */
export function kooijmansPhotoUrl(base: string, file: string): string {
  if (!base || !file) return '';
  return `${KOOIJMANS_BASE}/${base.replace(/^\//, '')}/${file}`;
}

/* -------------------------------------------------------------- DOT-NL — charging */

export interface ChargingPoint {
  id: string;
  latitude: number;
  longitude: number;
  operator?: string;
  open?: boolean;
  available?: number;
  total?: number;
  powerMaxW?: number;
  connector?: string;
}

let chargingCache: ChargingPoint[] | null = null;

/**
 * The NDW server serves the file as `application/gzip` (a download, not a
 * transfer encoding), so the browser will not decompress it for us. The
 * response body is a gzip stream, decompressed here with `DecompressionStream`.
 * ~4.9 MB gzipped, ~15 MB uncompressed — fetched once and cached.
 */
async function decompressGzip(body: Blob): Promise<string> {
  if (typeof DecompressionStream === 'function') {
    const reader = body.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(reader).text();
  }
  // No DecompressionStream (older engines): fall back to the raw body, which
  // only works when the server encodes, not when it attaches.
  return body.text();
}

/**
 * Loads the Netherlands-wide charging point GeoJSON (DOT-NL, CC-BY). Returns
 * an empty list when unreachable — this source is optional, one card's worth
 * of context, not the dashboard's spine.
 */

interface ChargingGeoJsonFeature {
  id?: string | number | null;
  geometry?: { coordinates?: [number, number] | [number, number, number] | null } | null;
  properties?: Record<string, unknown> | null;
}
interface ChargingGeoJson {
  features?: ChargingGeoJsonFeature[];
}

export async function fetchChargingPoints(
  signal?: AbortSignal,
): Promise<ChargingPoint[]> {
  if (chargingCache) return chargingCache;

  try {
    const response = await fetch(
      'https://opendata.ndw.nu/charging_point_locations.geojson.gz',
      { signal },
    );
    if (!response.ok) return [];

    const raw = await decompressGzip(await response.blob());
    const geojson = JSON.parse(raw) as ChargingGeoJson;
    const points: ChargingPoint[] = [];
    for (const feature of geojson.features ?? []) {
      const coords = feature.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const props = feature.properties as Record<string, unknown> | null ?? {};
      const availability = Array.isArray(props.availabilities)
        ? (props.availabilities[0] as Record<string, unknown> | undefined)
        : undefined;
      points.push({
        id: String(feature.id ?? ''),
        longitude: Number(coords[0]),
        latitude: Number(coords[1]),
        operator:
          typeof props.operator_name === 'string' ? props.operator_name : undefined,
        open: typeof props.open === 'boolean' ? props.open : undefined,
        available: typeof availability?.available === 'number' ? availability.available : undefined,
        total: typeof availability?.total === 'number' ? availability.total : undefined,
        powerMaxW: typeof availability?.power_max === 'number' ? availability.power_max : undefined,
        connector:
          typeof availability?.connector_type === 'string' ? availability.connector_type : undefined,
      });
    }
    chargingCache = points;
    return points;
  } catch {
    return [];
  }
}

/** Count charging points within a radius (in degrees) of a coordinate. */
export function chargingPointsNearby(
  points: ChargingPoint[],
  lat: number,
  lon: number,
  radiusDegrees = 0.15,
): number {
  const latMin = lat - radiusDegrees;
  const latMax = lat + radiusDegrees;
  const lonMin = lon - radiusDegrees;
  const lonMax = lon + radiusDegrees;
  return points.filter(
    (p) => p.latitude >= latMin && p.latitude <= latMax && p.longitude >= lonMin && p.longitude <= lonMax,
  ).length;
}

/* -------------------------------------------------------------- CBS StatLine */

export interface CbsVehicleCount {
  label: string;
  count: number;
}

let cbsCache: CbsVehicleCount[] | null = null;

/**
 * Fetches the CBS "Motorvoertuigen actief; type, leeftijdsklasse" table
 * (85243NED) via OData and returns the latest period's active fleet split by
 * vehicle type, at total age ("Totaal").
 *
 * CBS counts the *active* park: vehicles that actually drove in the previous
 * year, so a vehicle registered but uninsured all year drops out. The
 * dashboard's register count treats an insured-by-record number as registered.
 * That difference is the point of the benchmark card, not a bug.
 *
 * License: CC-BY 4.0. Source: opendata.cbs.nl, table 85243NED.
 */
export async function fetchCbsVehiclePark(
  signal?: AbortSignal,
): Promise<CbsVehicleCount[]> {
  if (cbsCache) return cbsCache;

  const base = 'https://opendata.cbs.nl/ODataApi/OData/85243NED';
  try {
    // CBS pads multi-level dimension keys with trailing spaces, so "Totaal"'s
    // key is '10000  ' in the wire format. The period has metadata years that
    // hold no data yet, so the current year is tried first and earlier years
    // walked back until a row answers.
    const ageKey = '10000  ';
    let row: Record<string, unknown> | undefined;
    const yearNow = new Date().getFullYear();
    for (let attempt = 0; attempt < 4 && !row; attempt++) {
      const period = `${yearNow - attempt}JJ00`;
      const url =
        `${base}/TypedDataSet?$filter=LeeftijdsklasseVoertuig eq '${ageKey}' and Perioden eq '${period}'` +
        `&$select=Perioden,TotaalMotorvoertuigen_1,Personenauto_2,TotaalBedrijfsvoertuigen_3,` +
        `Bestelauto_5,VrachtautoExclTrekkerVoorOplegger_6,TrekkerVoorOplegger_7,SpeciaalVoertuig_8,` +
        `Bus_9,Motorfiets_13`;
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
      if (!response.ok) continue;
      const data = (await response.json()) as { value: Array<Record<string, unknown>> };
      row = data.value?.[0];
    }
    if (!row) {
      cbsCache = [];
      return [];
    }

    const topics: Array<[string, string]> = [
      ['TotaalMotorvoertuigen_1', 'Totaal actief motorvoertuigenpark'],
      ['Personenauto_2', 'Personenauto\'s'],
      ['TotaalBedrijfsvoertuigen_3', 'Bedrijfsvoertuigen'],
      ['Bestelauto_5', 'Bestelauto\'s'],
      ['VrachtautoExclTrekkerVoorOplegger_6', 'Vrachtauto\'s (excl. trekker)'],
      ['TrekkerVoorOplegger_7', 'Trekkers voor oplegger'],
      ['Bus_9', 'Bussen'],
      ['Motorfiets_13', 'Motorfietsen'],
    ];
    const counts: CbsVehicleCount[] = topics
      .map(([key, label]) => ({ label, count: Number(row[key]) || 0 }))
      .filter((r) => r.count > 0);

    cbsCache = counts;
    return counts;
  } catch {
    return [];
  }
}

/* ----------------------------------------------------- CBS StatLine — nationaal */

/**
 * One OData table behind the CBS StatLine API. Rows are dimension-measure objects
 * keyed by column name; CBS pads multi-level dimension values with trailing
 * spaces, and `$orderby` on the period is ignored, so every caller trims keys
 * and sorts periods itself.
 */
async function oDataRows(base: string, table: 'TypedDataSet', select: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const url = `${base}/${table}?$select=${encodeURIComponent(select)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) return [];
  const data = (await response.json()) as { value?: Array<Record<string, unknown>> };
  return data.value ?? [];
}

interface CbsRow {
  [field: string]: unknown;
}

const trim = (value: unknown): string => String(value ?? '').trim();
const fin = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
/** Sorts CBS periods ("1990JJ00", "2020KW02") oldest first. */
const periodOrder = (a: string, b: string): number => a.localeCompare(b);

/* CBS 85347NED — road-transport emissions, aggregated over the whole fleet.
   CO2 is weighed in mln kg (26 633 mln kg in 2025 ≈ 26,6 megaton), so the
   viewer divides by 1000 before displaying it. */

export interface CbsRoadEmission {
  year: number;
  /** CO2 from road transport, in million kg. */
  co2MlnKg: number;
}

export interface CbsRoadEmissions {
  series: CbsRoadEmission[];
  /** Latest year with data, or null. */
  latestYear: number | null;
  /** CO2 split by vehicle category for the latest year, largest first. */
  byCategory: { label: string; co2MlnKg: number }[];
}

/** Pure and exported so the parser can be tested without a live call. */
export function parseCbsRoadEmissions(rows: CbsRow[]): CbsRoadEmissions {
  // The "Totaal" dimension value of 85347NED is 'A018928' - a code, not the
  // space-padded '10000  ' convention of the register tables.
  const totals = rows
    .filter((row) => trim(row.Voertuigtype) === 'A018928')
    .map((row) => ({
      period: trim(row.Perioden),
      co2MlnKg: fin(row.KooldioxideCO2_1) ?? 0,
    }))
    .sort((a, b) => periodOrder(a.period, b.period))
    .map((r) => ({ year: Number(r.period.slice(0, 4)), co2MlnKg: r.co2MlnKg }))
    .filter((r) => Number.isFinite(r.year));

  const latestPeriod = [...rows.map((r) => trim(r.Perioden))].sort(periodOrder).at(-1);
  const latestYear = latestPeriod?.startsWith('20') ? Number(latestPeriod.slice(0, 4)) : null;

  const categoryRows = rows
    .filter(
      (row) => trim(row.Voertuigtype) !== 'A018928' && trim(row.Perioden) === latestPeriod,
    )
    .map((row) => ({
      label: trim(row.Voertuigtype),
      co2MlnKg: fin(row.KooldioxideCO2_1) ?? 0,
    }))
    .filter((r) => r.co2MlnKg > 0)
    .sort((a, b) => b.co2MlnKg - a.co2MlnKg);

  return { series: totals, latestYear, byCategory: categoryRows };
}

let cbsEmissionsCache: CbsRoadEmissions | null = null;

export async function fetchCbsRoadEmissions(signal?: AbortSignal): Promise<CbsRoadEmissions> {
  if (cbsEmissionsCache) return cbsEmissionsCache;
  const base = 'https://opendata.cbs.nl/ODataApi/OData/85347NED';
  try {
    const rows = await oDataRows(base, 'TypedDataSet', 'Voertuigtype,Perioden,KooldioxideCO2_1', signal);
    const result = parseCbsRoadEmissions(rows);
    cbsEmissionsCache = result;
    return result;
  } catch {
    return { series: [], latestYear: null, byCategory: [] };
  }
}

/* CBS 84991NED — pump prices for motor fuels, by quarter. Values are euro per
   liter (CNG per kg, electricity per kWh), VAT and excise included. */

export interface CbsFuelPrice {
  /** CBS period label, e.g. "2026KW02". */
  period: string;
  benzine: number | null;
  diesel: number | null;
  lpg: number | null;
  cng: number | null;
  elektrisch: number | null;
}

export function parseCbsFuelPrices(rows: CbsRow[]): CbsFuelPrice[] {
  return rows
    .map((row) => ({
      period: trim(row.Perioden),
      benzine: fin(row.BenzineEuro95_1),
      diesel: fin(row.Diesel_2),
      lpg: fin(row.Lpg_3),
      cng: fin(row.Cng_4),
      elektrisch: fin(row.Elektrisch_5),
    }))
    .filter((row) => row.period.startsWith('20'))
    .sort((a, b) => periodOrder(a.period, b.period));
}

let cbsFuelCache: CbsFuelPrice[] | null = null;

export async function fetchCbsFuelPrices(signal?: AbortSignal): Promise<CbsFuelPrice[]> {
  if (cbsFuelCache) return cbsFuelCache;
  const base = 'https://opendata.cbs.nl/ODataApi/OData/84991NED';
  try {
    const rows = await oDataRows(
      base,
      'TypedDataSet',
      'Perioden,BenzineEuro95_1,Diesel_2,Lpg_3,Cng_4,Elektrisch_5',
      signal,
    );
    const result = parseCbsFuelPrices(rows);
    cbsFuelCache = result;
    return result;
  } catch {
    return [];
  }
}

/* CBS 71936NED — fatalities in Dutch road traffic. Annual, from 1996. */

export interface CbsRoadDeaths {
  series: { year: number; count: number }[];
  latestYear: number | null;
  latestTotal: number | null;
  /** Fatalities by mode of participation for the latest year, largest first. */
  byMode: { label: string; count: number }[];
}

export function parseCbsRoadDeaths(rows: CbsRow[]): CbsRoadDeaths {
  const totals = rows
    .filter(
      (row) =>
        trim(row.Geslacht) === 'T001038' &&
        trim(row.Leeftijd) === '10000' &&
        trim(row.WijzeVanDeelname) === 'T001568',
    )
    .map((row) => ({
      period: trim(row.Perioden),
      count: fin(row.Verkeersdoden_1) ?? 0,
    }))
    .sort((a, b) => periodOrder(a.period, b.period))
    .map((r) => ({ year: Number(r.period.slice(0, 4)), count: r.count }))
    .filter((r) => Number.isFinite(r.year));

  const latestPeriod = [...rows.map((r) => trim(r.Perioden))].sort(periodOrder).at(-1);
  const latestYear = latestPeriod?.startsWith('20') ? Number(latestPeriod.slice(0, 4)) : null;
  const latestTotal = totals.find((t) => t.year === latestYear)?.count ?? null;

  const MODE_NAMES: Record<string, string> = {
    A048748: 'Voetganger',
    A048749: 'Fiets',
    A048750: 'Brom- en snorfiets',
    A048751: 'Invalidenvoertuig',
    A048752: 'Motorfiets',
    A048753: 'Personenauto',
    A048754: 'Bestel-/vrachtwagen',
    A048755: 'Overig',
    A048756: 'Onbekend',
  };

  const byMode = rows
    .filter(
      (row) =>
        trim(row.WijzeVanDeelname) !== 'T001568' &&
        trim(row.Geslacht) === 'T001038' &&
        trim(row.Leeftijd) === '10000' &&
        trim(row.Perioden) === latestPeriod,
    )
    .map((row) => ({
      key: trim(row.WijzeVanDeelname),
      count: fin(row.Verkeersdoden_1) ?? 0,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ label: MODE_NAMES[r.key] ?? r.key, count: r.count }));

  return { series: totals, latestYear, latestTotal, byMode };
}

let cbsDeathsCache: CbsRoadDeaths | null = null;

export async function fetchCbsRoadDeaths(signal?: AbortSignal): Promise<CbsRoadDeaths> {
  if (cbsDeathsCache) return cbsDeathsCache;
  const base = 'https://opendata.cbs.nl/ODataApi/OData/71936NED';
  try {
    const rows = await oDataRows(
      base,
      'TypedDataSet',
      'Geslacht,Leeftijd,WijzeVanDeelname,Perioden,Verkeersdoden_1',
      signal,
    );
    const result = parseCbsRoadDeaths(rows);
    cbsDeathsCache = result;
    return result;
  } catch {
    return { series: [], latestYear: null, latestTotal: null, byMode: [] };
  }
}

/* ------------------------------------------------- RDW open data — parkeren */

/**
 * The RDW parking catalogue is five star-schema tables: the area facts link
 * named parkeergebieden to usage classes, and geometry rows give each area a
 * point. Joined here so one view can draw the whole country's parking zones.
 *
 *   PARKEERGEBIED      (mz4f-59fw)  area key  -> usage key   (the fact table)
 *   GEBIED             (adw6-9hsg)  area key  -> area name
 *   GEBRUIKSDOEL       (qidm-7mkf)  usage key -> usage label, spec indicator
 *   GEOMETRIE GEBIED   (nsk3-v9n7)  area key  -> WKT point
 */
export interface ParkingArea {
  /** "<areamanagerid>|<areaid>", the stable key across the tables. */
  key: string;
  name: string;
  usages: string[];
  longitude: number | null;
  latitude: number | null;
}

export interface ParkingCatalog {
  areas: ParkingArea[];
  totalAreas: number;
  locatedAreas: number;
  usageMix: { label: string; count: number }[];
}

const PARKING_AREA_KEY = (row: CbsRow): string =>
  `${trim(row.areamanagerid)}|${trim(row.areaid)}`;

/** Picks the newest "specific" usage label per area; generic supers sit on top.
    A "specificatie" indicator ('J') marks the concrete class (Betaald parkeren)
    under a generic parent (Parkeren), so it is preferred for charts. */
function bestPerArea(rows: CbsRow[], keyFn: (row: CbsRow) => string, pick: (rows: CbsRow[]) => string | null): Map<string, string> {
  const byKey = new Map<string, CbsRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const out = new Map<string, string>();
  for (const [key, list] of byKey) {
    const value = pick(list);
    if (value) out.set(key, value);
  }
  return out;
}

const preferNewest = (rows: CbsRow[], sortField: string): CbsRow | undefined =>
  rows.slice().sort((a, b) => trim(b[sortField]).localeCompare(trim(a[sortField])))[0];

export function parseParkingCatalog(
  areaFactRows: CbsRow[],
  areaNameRows: CbsRow[],
  usageRows: CbsRow[],
  geometryRows: CbsRow[],
): ParkingCatalog {
  // 1. area key -> newest name.
  const nameByKey = bestPerArea(
    areaNameRows,
    PARKING_AREA_KEY,
    (list) => trim(preferNewest(list, 'startdatearea')?.areadesc) || null,
  );

  // 2. area key -> newest coordinates (WKT "POINT (lon lat)").
  const newestGeometryStart = new Map<string, string>();
  for (const row of geometryRows) {
    const key = PARKING_AREA_KEY(row);
    const start = trim(row.startdatearea);
    if (start.localeCompare(newestGeometryStart.get(key) ?? '') > 0) {
      newestGeometryStart.set(key, start);
    }
  }
  const pointByKey = new Map<string, { longitude: number; latitude: number }>();
  for (const row of geometryRows) {
    const key = PARKING_AREA_KEY(row);
    if (trim(row.startdatearea) !== newestGeometryStart.get(key)) continue;
    const match = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(trim(row.areageometryastext));
    if (!match) continue;
    pointByKey.set(key, { longitude: Number(match[1]), latitude: Number(match[2]) });
  }

  // 3. area key -> newest specific usage labels (max two, superficial ones last).
  const specificLabelRows = usageRows.filter((r) => trim(r.specificationindicator) === 'J');
  const usageKey = (row: CbsRow): string => `${trim(row.areamanagerid)}|${trim(row.usageid)}`;
  const labelByUsage = bestPerArea(specificLabelRows, usageKey, (list) => trim(preferNewest(list, 'startdateusageid')?.usageiddesc) || null);
  const labelByArea = bestPerArea(areaFactRows, PARKING_AREA_KEY, (list) => {
    const labels = [
      ...new Set(list.map((row) => labelByUsage.get(`${trim(row.areamanagerid)}|${trim(row.usageid)}`)).filter((l): l is string => !!l)),
    ].sort();
    return labels[0] ?? null;
  });

  const areas: ParkingArea[] = [...nameByKey.keys()].map((key) => {
    const point = pointByKey.get(key);
    return {
      key,
      name: nameByKey.get(key) ?? 'Onbekend',
      usages: [labelByArea.get(key)].filter((l): l is string => !!l),
      longitude: point?.longitude ?? null,
      latitude: point?.latitude ?? null,
    };
  });

  const usageMix = new Map<string, number>();
  for (const area of areas) {
    const primary = area.usages[0] ?? 'Overig';
    usageMix.set(primary, (usageMix.get(primary) ?? 0) + 1);
  }

  return {
    areas,
    totalAreas: areas.length,
    locatedAreas: areas.filter((a) => a.longitude != null && a.latitude != null).length,
    usageMix: [...usageMix.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  };
}

let parkingCache: ParkingCatalog | null = null;

async function parkingRows(id: string, select: string, signal?: AbortSignal): Promise<CbsRow[]> {
  const url = `https://opendata.rdw.nl/resource/${id}.json?$select=${encodeURIComponent(select)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) return [];
  const data = (await response.json()) as CbsRow[] | { error?: unknown };
  return Array.isArray(data) ? data : [];
}

export async function fetchParkingCatalog(signal?: AbortSignal): Promise<ParkingCatalog> {
  if (parkingCache) return parkingCache;
  try {
    const [facts, names, usages, geometry] = await Promise.all([
      parkingRows('mz4f-59fw', 'areamanagerid,areaid,usageid', signal),
      parkingRows('adw6-9hsg', 'areamanagerid,areaid,areadesc,startdatearea', signal),
      parkingRows('qidm-7mkf', 'areamanagerid,usageid,usageiddesc,specificationindicator,startdateusageid', signal),
      parkingRows('nsk3-v9n7', 'areamanagerid,areaid,areageometryastext,startdatearea', signal),
    ]);
    const result = parseParkingCatalog(facts, names, usages, geometry);
    parkingCache = result;
    return result;
  } catch {
    return { areas: [], totalAreas: 0, locatedAreas: 0, usageMix: [] };
  }
}

export function clearExternalCaches(): void {
  kooijmansCache = new Map();
  chargingCache = null;
  cbsCache = null;
  cbsEmissionsCache = null;
  cbsFuelCache = null;
  cbsDeathsCache = null;
  parkingCache = null;
}
