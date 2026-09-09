/**
 * Registry of the RDW (Rijksdienst voor het Wegverkeer) open-data resources
 * this dashboard reads, on the Socrata platform at opendata.rdw.nl.
 *
 * Every dataset is a Socrata resource addressed by its four-four identifier:
 *   https://opendata.rdw.nl/resource/<id>.json?<SoQL>
 *
 * `confidence` records how sure we are of the identifier/field names without a
 * live call. `npm run verify:datasets` checks every entry against the live API
 * and prints a pass/fail table - run it before trusting a panel.
 */

export type Confidence = 'verified' | 'high' | 'medium';

export interface DatasetSpec {
  /** Socrata four-four resource id. */
  id: string;
  /** Human label, as published by RDW. */
  name: string;
  /** What the rows are, one per line. */
  grain: string;
  /** Fields the dashboard depends on; the verifier asserts each one exists. */
  fields: readonly string[];
  /** Field the row joins on, when it is a per-vehicle detail table. */
  joinKey?: string;
  confidence: Confidence;
  /** Whether the dashboard can render at all without it. */
  required: boolean;
}

export const DATASETS = {
  /** The spine. One row per registered vehicle in the Netherlands (~16M). */
  vehicles: {
    id: 'm9d7-ebf2',
    name: 'Gekentekende voertuigen',
    grain: 'One row per licence plate (kenteken).',
    joinKey: 'kenteken',
    confidence: 'high',
    required: true,
    fields: [
      'kenteken',
      'voertuigsoort',
      'merk',
      'handelsbenaming',
      'inrichting',
      'eerste_kleur',
      'tweede_kleur',
      'aantal_zitplaatsen',
      'aantal_deuren',
      'aantal_wielen',
      'aantal_cilinders',
      'cilinderinhoud',
      'massa_ledig_voertuig',
      'massa_rijklaar',
      'toegestane_maximum_massa_voertuig',
      'catalogusprijs',
      'lengte',
      'breedte',
      'wielbasis',
      'maximale_constructiesnelheid',
      'europese_voertuigcategorie',
      'zuinigheidsclassificatie',
      'wam_verzekerd',
      'export_indicator',
      'taxi_indicator',
      'openstaande_terugroepactie_indicator',
      'datum_eerste_toelating_dt',
      'datum_eerste_tenaamstelling_in_nederland_dt',
      'datum_tenaamstelling_dt',
      'vervaldatum_apk_dt',
    ],
  },

  /** Emissions and powertrain. One row per fuel per vehicle - hybrids have two. */
  fuel: {
    id: '8ys7-d773',
    name: 'Gekentekende voertuigen brandstof',
    grain: 'One row per fuel per vehicle (a plug-in hybrid has two).',
    joinKey: 'kenteken',
    confidence: 'high',
    required: true,
    fields: [
      'kenteken',
      'brandstof_volgnummer',
      'brandstof_omschrijving',
      'co2_uitstoot_gecombineerd',
      'brandstofverbruik_gecombineerd',
      'nettomaximumvermogen',
      'emissiecode_omschrijving',
      'geluidsniveau_rijdend',
      'milieuklasse_eg_goedkeuring_licht',
    ],
  },

  /** Body type. Joins the fleet to what the vehicle physically is. */
  body: {
    id: '3huj-srit',
    name: 'Gekentekende voertuigen carrosserie',
    grain: 'One row per body record per vehicle.',
    joinKey: 'kenteken',
    confidence: 'medium',
    required: false,
    fields: ['kenteken', 'carrosserie_volgnummer', 'type_carrosserie_europese_omschrijving'],
  },

  /** Every defect an inspector recorded at a periodic roadworthiness test (APK). */
  defectsFound: {
    id: 'a34c-vvps',
    name: 'Geconstateerde gebreken',
    grain: 'One row per defect found at one inspection of one vehicle.',
    joinKey: 'kenteken',
    confidence: 'medium',
    required: false,
    fields: [
      'kenteken',
      'gebrek_identificatie',
      'meld_datum_door_keuringsinstantie_dt',
      'aantal_gebreken_geconstateerd',
    ],
  },

  /** The defect lexicon: turns a code such as "RA0" into a sentence. */
  defectCodes: {
    id: 'hx2c-gt7k',
    name: 'Gebreken',
    grain: 'One row per defect code in the statutory list.',
    joinKey: 'gebrek_identificatie',
    confidence: 'medium',
    required: false,
    fields: ['gebrek_identificatie', 'gebrek_omschrijving', 'gebrek_artikel_nummer'],
  },

  /** Axle-level detail - load, track width, suspension. Used on the passport. */
  axles: {
    id: 'w4rt-e856',
    name: 'Gekentekende voertuigen assen',
    grain: 'One row per axle per vehicle.',
    joinKey: 'kenteken',
    confidence: 'medium',
    required: false,
    fields: ['kenteken', 'as_nummer', 'aantal_assen', 'aangedreven_as', 'spoorbreedte'],
  },

  /** EU vehicle class codes held against a plate. Used on the passport. */
  vehicleClass: {
    id: 'kmfi-hrps',
    name: 'Gekentekende voertuigen voertuigklasse',
    grain: 'One row per vehicle-class code per vehicle.',
    joinKey: 'kenteken',
    confidence: 'medium',
    required: false,
    fields: ['kenteken', 'volgnummer', 'code_toevoeging_uitvoering'],
  },
} as const satisfies Record<string, DatasetSpec>;

export type DatasetKey = keyof typeof DATASETS;

export const RDW_DOMAIN = 'https://opendata.rdw.nl';

/** Human-facing link to the dataset's landing page, for provenance footers. */
export const datasetPage = (key: DatasetKey): string =>
  `${RDW_DOMAIN}/d/${DATASETS[key].id}`;
