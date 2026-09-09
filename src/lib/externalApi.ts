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
  dotNl: {
    label: 'DOT-NL laadpalen',
    url: 'https://opendata.ndw.nu/',
    license: 'CC-BY',
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

export function clearExternalCaches(): void {
  kooijmansCache = new Map();
  chargingCache = null;
  cbsCache = null;
}
