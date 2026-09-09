/**
 * Deterministic synthetic RDW-shaped data.
 *
 * This exists so the dashboard can be developed, screenshotted and demoed
 * without hitting the live API, and so a reviewer can see every panel populated
 * offline. The rows follow RDW's real column names, types and code lists, and
 * carry the correlations the real fleet has (electric share climbing by year,
 * CO2 tracking mass and fuel, defects tracking age) - but the values are
 * generated. Anything rendered from here is labelled "demo data" in the UI.
 */

export interface VehicleRow {
  kenteken: string;
  voertuigsoort: string;
  merk: string;
  handelsbenaming: string;
  inrichting: string;
  eerste_kleur: string;
  aantal_zitplaatsen: string;
  aantal_deuren: string;
  aantal_wielen: string;
  aantal_cilinders: string;
  cilinderinhoud: string;
  massa_ledig_voertuig: string;
  massa_rijklaar: string;
  toegestane_maximum_massa_voertuig: string;
  catalogusprijs: string;
  lengte: string;
  breedte: string;
  wielbasis: string;
  maximale_constructiesnelheid: string;
  europese_voertuigcategorie: string;
  zuinigheidsclassificatie: string;
  wam_verzekerd: string;
  export_indicator: string;
  taxi_indicator: string;
  openstaande_terugroepactie_indicator: string;
  datum_eerste_toelating_dt: string;
  datum_eerste_tenaamstelling_in_nederland_dt: string;
  datum_tenaamstelling_dt: string;
  vervaldatum_apk_dt: string;
}

export interface FuelRow {
  kenteken: string;
  brandstof_volgnummer: string;
  brandstof_omschrijving: string;
  co2_uitstoot_gecombineerd: string;
  brandstofverbruik_gecombineerd: string;
  nettomaximumvermogen: string;
  emissiecode_omschrijving: string;
  geluidsniveau_rijdend: string;
  milieuklasse_eg_goedkeuring_licht: string;
}

export interface BodyRow {
  kenteken: string;
  carrosserie_volgnummer: string;
  type_carrosserie_europese_omschrijving: string;
}

export interface DefectFoundRow {
  kenteken: string;
  gebrek_identificatie: string;
  meld_datum_door_keuringsinstantie_dt: string;
  aantal_gebreken_geconstateerd: string;
}

export interface DefectCodeRow {
  gebrek_identificatie: string;
  gebrek_omschrijving: string;
  gebrek_artikel_nummer: string;
}

export interface AxleRow {
  kenteken: string;
  as_nummer: string;
  aantal_assen: string;
  aangedreven_as: string;
  spoorbreedte: string;
}

export interface VehicleClassRow {
  kenteken: string;
  volgnummer: string;
  code_toevoeging_uitvoering: string;
}

export interface DemoData {
  vehicles: VehicleRow[];
  fuel: FuelRow[];
  body: BodyRow[];
  defectsFound: DefectFoundRow[];
  defectCodes: DefectCodeRow[];
  axles: AxleRow[];
  vehicleClass: VehicleClassRow[];
}

/** mulberry32 - small, fast, and seeded, so every run renders the same fleet. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Brand {
  name: string;
  weight: number;
  /** Price multiplier - a premium marque costs more at equal mass. */
  tier: number;
  models: string[];
  /** Multiplier on the fleet-wide electric share. */
  evBias: number;
}

const BRANDS: Brand[] = [
  { name: 'VOLKSWAGEN', weight: 132, tier: 1.0, evBias: 1.1, models: ['GOLF', 'POLO', 'PASSAT', 'T-ROC', 'ID.3', 'TIGUAN'] },
  { name: 'OPEL', weight: 92, tier: 0.85, evBias: 0.8, models: ['ASTRA', 'CORSA', 'MOKKA', 'INSIGNIA', 'ZAFIRA'] },
  { name: 'RENAULT', weight: 74, tier: 0.85, evBias: 1.2, models: ['CLIO', 'MEGANE', 'CAPTUR', 'ZOE', 'SCENIC'] },
  { name: 'PEUGEOT', weight: 71, tier: 0.88, evBias: 0.9, models: ['208', '308', '2008', '3008', '5008'] },
  { name: 'TOYOTA', weight: 68, tier: 0.98, evBias: 0.7, models: ['YARIS', 'COROLLA', 'AYGO', 'RAV4', 'C-HR'] },
  { name: 'FORD', weight: 63, tier: 0.9, evBias: 0.6, models: ['FIESTA', 'FOCUS', 'KUGA', 'PUMA', 'MONDEO'] },
  { name: 'BMW', weight: 47, tier: 1.75, evBias: 1.3, models: ['3 SERIE', '1 SERIE', 'X1', '5 SERIE', 'I4'] },
  { name: 'MERCEDES-BENZ', weight: 45, tier: 1.85, evBias: 1.1, models: ['A-KLASSE', 'C-KLASSE', 'E-KLASSE', 'GLA', 'SPRINTER'] },
  { name: 'AUDI', weight: 43, tier: 1.7, evBias: 1.2, models: ['A3', 'A4', 'Q3', 'A1', 'Q4 E-TRON'] },
  { name: 'KIA', weight: 38, tier: 0.95, evBias: 1.5, models: ['PICANTO', 'CEED', 'NIRO', 'SPORTAGE', 'EV6'] },
  { name: 'HYUNDAI', weight: 36, tier: 0.95, evBias: 1.6, models: ['I10', 'I20', 'TUCSON', 'KONA', 'IONIQ 5'] },
  { name: 'VOLVO', weight: 30, tier: 1.6, evBias: 1.4, models: ['V40', 'XC40', 'V60', 'XC60', 'EX30'] },
  { name: 'SKODA', weight: 29, tier: 0.95, evBias: 1.0, models: ['OCTAVIA', 'FABIA', 'KAROQ', 'SUPERB', 'ENYAQ'] },
  { name: 'CITROEN', weight: 27, tier: 0.82, evBias: 0.9, models: ['C3', 'C1', 'C4', 'BERLINGO', 'C5 AIRCROSS'] },
  { name: 'SEAT', weight: 24, tier: 0.9, evBias: 0.8, models: ['IBIZA', 'LEON', 'ARONA', 'ATECA'] },
  { name: 'NISSAN', weight: 23, tier: 0.92, evBias: 1.3, models: ['QASHQAI', 'MICRA', 'JUKE', 'LEAF'] },
  { name: 'FIAT', weight: 21, tier: 0.8, evBias: 0.9, models: ['500', 'PANDA', 'PUNTO', 'DUCATO'] },
  { name: 'MAZDA', weight: 18, tier: 1.05, evBias: 0.7, models: ['2', '3', 'CX-5', 'CX-30'] },
  { name: 'SUZUKI', weight: 16, tier: 0.85, evBias: 0.5, models: ['SWIFT', 'VITARA', 'IGNIS'] },
  { name: 'TESLA', weight: 14, tier: 2.1, evBias: 9.0, models: ['MODEL 3', 'MODEL Y', 'MODEL S'] },
  { name: 'DACIA', weight: 13, tier: 0.7, evBias: 0.6, models: ['SANDERO', 'DUSTER', 'SPRING'] },
  { name: 'MINI', weight: 12, tier: 1.5, evBias: 1.1, models: ['COOPER', 'COUNTRYMAN'] },
  { name: 'HONDA', weight: 10, tier: 1.05, evBias: 0.8, models: ['JAZZ', 'CIVIC', 'HR-V'] },
  { name: 'MITSUBISHI', weight: 9, tier: 0.9, evBias: 1.1, models: ['SPACE STAR', 'OUTLANDER', 'ASX'] },
];

const BODY_BY_INRICHTING: Record<string, string> = {
  hatchback: 'AB - Hatchback',
  stationwagen: 'AC - Stationwagen',
  sedan: 'AA - Sedan',
  MPV: 'AF - Multipurpose voertuig',
  cabriolet: 'AE - Cabriolet',
  coupe: 'AD - Coupe',
  'gesloten opbouw': 'BB - Gesloten opbouw',
};

const SEGMENTS = [
  { inrichting: 'hatchback', weight: 40, mass: 1120, seats: 5, doors: 5 },
  { inrichting: 'stationwagen', weight: 15, mass: 1420, seats: 5, doors: 5 },
  { inrichting: 'sedan', weight: 12, mass: 1380, seats: 5, doors: 4 },
  { inrichting: 'MPV', weight: 14, mass: 1520, seats: 7, doors: 5 },
  { inrichting: 'cabriolet', weight: 3, mass: 1390, seats: 4, doors: 2 },
  { inrichting: 'coupe', weight: 4, mass: 1360, seats: 4, doors: 2 },
  { inrichting: 'gesloten opbouw', weight: 12, mass: 1780, seats: 3, doors: 4 },
];

const COLOURS: [string, number][] = [
  ['GRIJS', 260], ['ZWART', 210], ['BLAUW', 175], ['WIT', 135], ['ROOD', 105],
  ['GROEN', 42], ['BRUIN', 24], ['BEIGE', 14], ['GEEL', 12], ['PAARS', 6], ['ORANJE', 6],
];

const DEFECT_LEXICON: DefectCodeRow[] = [
  ['RA0', 'Bandenprofiel is minder dan 1,6 mm', '5.2.27'],
  ['R51', 'Remslang vertoont beschadiging of lekkage', '5.2.18'],
  ['R14', 'Bedrijfsrem werkt onvoldoende', '5.2.10'],
  ['A05', 'Verlichting aan de voorzijde werkt niet', '5.2.51'],
  ['A06', 'Verlichting aan de achterzijde werkt niet', '5.2.53'],
  ['K12', 'Schokdemper is defect of lekt', '5.2.24'],
  ['C31', 'Roest of corrosie in dragend deel van de carrosserie', '5.2.44'],
  ['B22', 'Uitlaatsysteem is lek of ondeugdelijk bevestigd', '5.2.11'],
  ['S18', 'Stuurhuis vertoont speling', '5.2.21'],
  ['V07', 'Voorruit is beschadigd in het zichtveld', '5.2.45'],
  ['G09', 'Gasontladingslamp is niet correct afgesteld', '5.2.52'],
  ['W03', 'Wiellager vertoont te veel speling', '5.2.26'],
  ['E11', 'Emissiewaarden overschrijden de norm', '5.2.11a'],
  ['Z04', 'Veiligheidsgordel is beschadigd', '5.2.47'],
  ['D02', 'Deur of slot sluit niet deugdelijk', '5.2.43'],
  ['K21', 'Veerpoot of veer is gebroken', '5.2.24'],
  ['R33', 'Parkeerrem werkt onvoldoende', '5.2.13'],
  ['A19', 'Richtingaanwijzer functioneert niet', '5.2.55'],
].map(([id, text, art]) => ({
  gebrek_identificatie: id as string,
  gebrek_omschrijving: text as string,
  gebrek_artikel_nummer: art as string,
}));

/** Weighted pick over `[item, weight]` pairs. */
function weighted<T>(rand: () => number, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1]![0];
}

/** Box-Muller, clamped - gives mass and price a believable spread. */
function gauss(rand: () => number, mean: number, sd: number, lo: number, hi: number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(hi, Math.max(lo, mean + z * sd));
}

/** Fleet-wide electric share for a first-admission year - an S-curve. */
function evShare(year: number): number {
  if (year < 2011) return 0.001;
  return 0.44 / (1 + Math.exp(-(year - 2021.5) / 1.9));
}

const PLATE_LETTERS = 'BDFGHJKLNPRSTVXZ';

function plate(rand: () => number): string {
  const l = () => PLATE_LETTERS[Math.floor(rand() * PLATE_LETTERS.length)]!;
  const d = () => String(Math.floor(rand() * 10));
  return `${l()}${l()}${d()}${d()}${l()}${l()}`;
}

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000`;

export interface GenerateOptions {
  count?: number;
  seed?: number;
  /** The "today" the fleet is generated relative to. */
  today?: Date;
}

export function generateDemoData(options: GenerateOptions = {}): DemoData {
  const count = options.count ?? 24000;
  const rand = rng(options.seed ?? 20260909);
  const today = options.today ?? new Date();
  const thisYear = today.getFullYear();

  const vehicles: VehicleRow[] = [];
  const fuel: FuelRow[] = [];
  const body: BodyRow[] = [];
  const defectsFound: DefectFoundRow[] = [];
  const axles: AxleRow[] = [];
  const vehicleClass: VehicleClassRow[] = [];
  const seen = new Set<string>();

  const brandPicks = BRANDS.map((b) => [b, b.weight] as const);
  const segmentPicks = SEGMENTS.map((s) => [s, s.weight] as const);

  for (let i = 0; i < count; i++) {
    let kenteken = plate(rand);
    while (seen.has(kenteken)) kenteken = plate(rand);
    seen.add(kenteken);

    // Registration year: recent years are over-represented, as in the real fleet.
    const yearSpan = 30;
    const skew = Math.pow(rand(), 0.55);
    const year = Math.min(thisYear, Math.round(thisYear - yearSpan + skew * yearSpan));
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    const age = thisYear - year;

    const brand = weighted(rand, brandPicks);
    const modelIndex = Math.floor(rand() * brand.models.length);
    const segment = weighted(rand, segmentPicks);

    const isCommercial = segment.inrichting === 'gesloten opbouw';
    const voertuigsoort = isCommercial ? 'Bedrijfsauto' : 'Personenauto';

    // Powertrain. The electric share follows the year curve, tilted by marque.
    const pEv = Math.min(0.97, evShare(year) * brand.evBias);
    const pHybrid = year >= 2012 ? Math.min(0.22, 0.02 + (year - 2012) * 0.018) : 0;
    const pDiesel = isCommercial ? 0.55 : Math.max(0.02, 0.28 - Math.max(0, year - 2010) * 0.018);
    const roll = rand();
    let powertrain: 'ev' | 'hybrid' | 'diesel' | 'lpg' | 'petrol';
    if (roll < pEv) powertrain = 'ev';
    else if (roll < pEv + pHybrid) powertrain = 'hybrid';
    else if (roll < pEv + pHybrid + pDiesel) powertrain = 'diesel';
    else if (roll < pEv + pHybrid + pDiesel + 0.02) powertrain = 'lpg';
    else powertrain = 'petrol';

    // Mass, then everything that follows from it.
    const evMassBonus = powertrain === 'ev' ? 260 : powertrain === 'hybrid' ? 130 : 0;
    const modernMassCreep = Math.max(0, year - 2000) * 5.5;
    const massLedig = Math.round(
      gauss(rand, segment.mass + evMassBonus + modernMassCreep, 165, 640, 3200),
    );
    const massRijklaar = massLedig + 100;
    const maxMassa = Math.round(massLedig * (isCommercial ? 1.75 : 1.42));

    const powerKw = Math.round(
      gauss(rand, powertrain === 'ev' ? massLedig * 0.105 : massLedig * 0.072, 18, 30, 500),
    );

    // CO2: falls with model year, rises with mass, zero for battery-electric.
    let co2: number | null;
    if (powertrain === 'ev') co2 = 0;
    else {
      const base = massLedig * 0.093 + (powertrain === 'diesel' ? 6 : 18);
      const efficiencyGain = Math.max(0, year - 2000) * 1.55;
      const hybridCut = powertrain === 'hybrid' ? 0.55 : 1;
      co2 = Math.round(Math.max(18, gauss(rand, (base - efficiencyGain) * hybridCut, 17, 18, 420)));
      if (year < 2001 && rand() < 0.55) co2 = null; // pre-registration gaps, as in the real data
    }

    const consumption =
      co2 == null ? null : powertrain === 'diesel' ? co2 / 26.5 : co2 / 23.2;

    const price = Math.round(
      gauss(rand, massLedig * 21 * brand.tier * (powertrain === 'ev' ? 1.28 : 1), 5200, 4200, 220000) /
        50,
    ) * 50;

    const apkYear = age > 4 ? thisYear + (rand() < 0.55 ? 0 : 1) : year + 4;

    vehicles.push({
      kenteken,
      voertuigsoort,
      merk: brand.name,
      handelsbenaming: brand.models[modelIndex]!,
      inrichting: segment.inrichting,
      eerste_kleur: weighted(rand, COLOURS),
      aantal_zitplaatsen: String(segment.seats),
      aantal_deuren: String(segment.doors),
      aantal_wielen: '4',
      aantal_cilinders: powertrain === 'ev' ? '0' : String(massLedig > 1500 ? 4 : rand() < 0.3 ? 3 : 4),
      cilinderinhoud: powertrain === 'ev' ? '0' : String(Math.round(gauss(rand, 1500, 320, 700, 4200) / 50) * 50),
      massa_ledig_voertuig: String(massLedig),
      massa_rijklaar: String(massRijklaar),
      toegestane_maximum_massa_voertuig: String(maxMassa),
      catalogusprijs: String(price),
      lengte: String(Math.round(gauss(rand, 430, 38, 300, 720))),
      breedte: String(Math.round(gauss(rand, 180, 9, 150, 235))),
      wielbasis: String(Math.round(gauss(rand, 265, 22, 190, 400))),
      maximale_constructiesnelheid: String(Math.round(gauss(rand, 190, 22, 120, 260))),
      europese_voertuigcategorie: isCommercial ? 'N1' : 'M1',
      zuinigheidsclassificatie:
        co2 == null ? '' : co2 === 0 ? 'A' : co2 < 90 ? 'B' : co2 < 120 ? 'C' : co2 < 160 ? 'D' : 'E',
      wam_verzekerd: rand() < 0.975 ? 'Ja' : 'Nee',
      export_indicator: rand() < 0.035 ? 'Ja' : 'Nee',
      taxi_indicator: rand() < 0.012 ? 'Ja' : 'Nee',
      openstaande_terugroepactie_indicator: rand() < 0.028 ? 'Ja' : 'Nee',
      datum_eerste_toelating_dt: iso(year, month, day),
      datum_eerste_tenaamstelling_in_nederland_dt: iso(year, month, day),
      datum_tenaamstelling_dt: iso(
        Math.min(thisYear, year + Math.floor(rand() * Math.max(1, age + 1))),
        1 + Math.floor(rand() * 12),
        1 + Math.floor(rand() * 28),
      ),
      vervaldatum_apk_dt: iso(apkYear, 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)),
    });

    // --- fuel rows: a hybrid is two rows, which is why fuel counts exceed vehicles
    const euroClass = year >= 2015 ? 'Euro 6' : year >= 2011 ? 'Euro 5' : year >= 2006 ? 'Euro 4' : 'Euro 3';
    const pushFuel = (seq: number, label: string, rowCo2: number | null) => {
      fuel.push({
        kenteken,
        brandstof_volgnummer: String(seq),
        brandstof_omschrijving: label,
        co2_uitstoot_gecombineerd: rowCo2 == null ? '' : String(rowCo2),
        brandstofverbruik_gecombineerd:
          consumption == null || label === 'Elektriciteit' ? '' : consumption.toFixed(1),
        nettomaximumvermogen: String(powerKw),
        emissiecode_omschrijving: label === 'Elektriciteit' ? '' : euroClass.replace('Euro ', ''),
        geluidsniveau_rijdend: String(Math.round(gauss(rand, 70, 3, 58, 84))),
        milieuklasse_eg_goedkeuring_licht: label === 'Elektriciteit' ? '' : euroClass,
      });
    };

    if (powertrain === 'ev') pushFuel(1, 'Elektriciteit', 0);
    else if (powertrain === 'hybrid') {
      pushFuel(1, 'Benzine', co2);
      pushFuel(2, 'Elektriciteit', 0);
    } else if (powertrain === 'diesel') pushFuel(1, 'Diesel', co2);
    else if (powertrain === 'lpg') {
      pushFuel(1, 'Benzine', co2);
      pushFuel(2, 'LPG', co2 == null ? null : Math.round(co2 * 0.87));
    } else pushFuel(1, 'Benzine', co2);

    body.push({
      kenteken,
      carrosserie_volgnummer: '1',
      type_carrosserie_europese_omschrijving:
        BODY_BY_INRICHTING[segment.inrichting] ?? 'AB - Hatchback',
    });

    axles.push(
      { kenteken, as_nummer: '1', aantal_assen: '2', aangedreven_as: 'J', spoorbreedte: String(Math.round(massLedig / 8.7)) },
      { kenteken, as_nummer: '2', aantal_assen: '2', aangedreven_as: powertrain === 'ev' ? 'J' : 'N', spoorbreedte: String(Math.round(massLedig / 8.8)) },
    );

    vehicleClass.push({ kenteken, volgnummer: '1', code_toevoeging_uitvoering: isCommercial ? 'N1' : 'M1' });

    // --- inspection defects: rate climbs with age, and older cars fail on wear items
    if (age >= 4) {
      const inspections = Math.min(6, Math.floor((age - 3) / 2) + 1);
      for (let n = 0; n < inspections; n++) {
        const inspYear = thisYear - n * 2;
        if (inspYear < year) break;
        const defectChance = Math.min(0.72, 0.06 + age * 0.028);
        if (rand() > defectChance) continue;
        const howMany = 1 + Math.floor(Math.pow(rand(), 2.2) * 3);
        for (let k = 0; k < howMany; k++) {
          // Wear items dominate; the lexicon is ordered most- to least-common.
          const idx = Math.min(
            DEFECT_LEXICON.length - 1,
            Math.floor(Math.pow(rand(), 1.9) * DEFECT_LEXICON.length),
          );
          defectsFound.push({
            kenteken,
            gebrek_identificatie: DEFECT_LEXICON[idx]!.gebrek_identificatie,
            meld_datum_door_keuringsinstantie_dt: iso(inspYear, 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)),
            aantal_gebreken_geconstateerd: '1',
          });
        }
      }
    }
  }

  return { vehicles, fuel, body, defectsFound, defectCodes: DEFECT_LEXICON, axles, vehicleClass };
}
