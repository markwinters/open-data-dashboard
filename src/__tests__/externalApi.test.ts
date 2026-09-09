import { describe, expect, it } from 'vitest';
import {
  parseCbsRoadEmissions,
  parseCbsFuelPrices,
  parseCbsRoadDeaths,
  parseParkingCatalog,
} from '../lib/externalApi';

/**
 * The CBS and RDW-parking parsers are the only network-free parts of the new
 * national-context layers. Each one reduces wire rows to the shape a view
 * draws, so the truncation/encoding quirks - padded keys, per-type totals,
 * WKT points - are pinned here without a live call.
 */

describe('parseCbsRoadEmissions', () => {
  it('separates the total series from the latest-year category split', () => {
    const rows = [
      { Voertuigtype: 'A018928', Perioden: '1990JJ00', KooldioxideCO2_1: 23986 },
      { Voertuigtype: 'A018928', Perioden: '2025JJ00', KooldioxideCO2_1: 26633 },
      { Voertuigtype: 'A019836', Perioden: '2025JJ00', KooldioxideCO2_1: 13000 },
      { Voertuigtype: 'A019837', Perioden: '2025JJ00', KooldioxideCO2_1: 9000 },
      // Older category rows must not leak into the latest-year split.
      { Voertuigtype: 'A019836', Perioden: '2020JJ00', KooldioxideCO2_1: 14000 },
    ];
    const result = parseCbsRoadEmissions(rows);
    expect(result.series).toEqual([
      { year: 1990, co2MlnKg: 23986 },
      { year: 2025, co2MlnKg: 26633 },
    ]);
    expect(result.latestYear).toBe(2025);
    expect(result.byCategory.map((c) => c.co2MlnKg)).toEqual([13000, 9000]);
  });
});

describe('parseCbsFuelPrices', () => {
  it('keeps quarters in period order and maps every fuel column', () => {
    const rows = [
      { Perioden: '2021KW02', BenzineEuro95_1: 1.9, Diesel_2: 1.5, Lpg_3: 0.7, Cng_4: 1.1, Elektrisch_5: 0.4 },
      { Perioden: '2021KW01', BenzineEuro95_1: 1.8, Diesel_2: 1.4, Lpg_3: 0.6, Cng_4: 1.0, Elektrisch_5: 0.3 },
    ];
    const result = parseCbsFuelPrices(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.period).toBe('2021KW01');
    expect(result[1]!.period).toBe('2021KW02');
    expect(result[1]!.benzine).toBe(1.9);
    expect(result[1]!.lpg).toBe(0.7);
    expect(result[1]!.cng).toBe(1.1);
    expect(result[1]!.elektrisch).toBe(0.4);
  });
});

describe('parseCbsRoadDeaths', () => {
  it('builds the annual series and maps the mode codes for the latest year', () => {
    const rows = [
      { Geslacht: 'T001038', Leeftijd: '10000', WijzeVanDeelname: 'T001568', Perioden: '1996JJ00', Verkeersdoden_1: 1251 },
      { Geslacht: 'T001038', Leeftijd: '10000', WijzeVanDeelname: 'T001568', Perioden: '2024JJ00', Verkeersdoden_1: 688 },
      // Per mode for 2024 - the codes that must become proper names.
      { Geslacht: 'T001038', Leeftijd: '10000', WijzeVanDeelname: 'A048749', Perioden: '2024JJ00', Verkeersdoden_1: 246 },
      { Geslacht: 'T001038', Leeftijd: '10000', WijzeVanDeelname: 'A048753', Perioden: '2024JJ00', Verkeersdoden_1: 220 },
      // An older mode row belongs to an older period and stays out.
      { Geslacht: 'T001038', Leeftijd: '10000', WijzeVanDeelname: 'A048749', Perioden: '1996JJ00', Verkeersdoden_1: 400 },
    ];
    const result = parseCbsRoadDeaths(rows);
    expect(result.latestYear).toBe(2024);
    expect(result.latestTotal).toBe(688);
    expect(result.series.map((d) => d.year)).toEqual([1996, 2024]);
    expect(result.byMode).toEqual([
      { label: 'Fiets', count: 246 },
      { label: 'Personenauto', count: 220 },
    ]);
  });
});

describe('parseParkingCatalog', () => {
  it('joins the star schema into named, located areas with their primary use', () => {
    const facts = [
      { areamanagerid: '1', areaid: 'A', usageid: 'BETAALDP' },
      { areamanagerid: '1', areaid: 'A', usageid: 'VERGUNP' },
    ];
    const names = [{ areamanagerid: '1', areaid: 'A', areadesc: 'de kaart', startdatearea: '20200101' }];
    const usages = [
      { areamanagerid: '1', usageid: 'BETAALDP', usageiddesc: 'Betaald Parkeren', specificationindicator: 'J', startdateusageid: '20200101' },
      { areamanagerid: '1', usageid: 'VERGUNP', usageiddesc: 'Vergunning', specificationindicator: 'J', startdateusageid: '20200101' },
      // A generic parent must come out behind a specific class.
      { areamanagerid: '1', usageid: 'PARKEREN', usageiddesc: 'Parkeren', specificationindicator: 'N', startdateusageid: '20200101' },
    ];
    const geometry = [{ areamanagerid: '1', areaid: 'A', areageometryastext: 'POINT (5.703246 51.256492)', startdatearea: '20200101' }];

    const result = parseParkingCatalog(facts, names, usages, geometry);
    expect(result.totalAreas).toBe(1);
    expect(result.locatedAreas).toBe(1);
    expect(result.areas[0]).toMatchObject({
      key: '1|A',
      name: 'de kaart',
      longitude: 5.703246,
      latitude: 51.256492,
    });
    expect(result.usageMix).toEqual([{ label: 'Betaald Parkeren', count: 1 }]);
  });

  it('ignores rows whose WKT point cannot be read', () => {
    const geometry = [
      // A polygon is not a point.
      { areamanagerid: '1', areaid: 'A', areageometryastext: 'POLYGON ((5 4, 6 4, 6 5, 5 5))', startdatearea: '20200101' },
      { areamanagerid: '1', areaid: 'B', areageometryastext: '', startdatearea: '20200101' },
    ];
    const result = parseParkingCatalog([{ areamanagerid: '0', areaid: 'x', usageid: 'U' }], [], [], geometry);
    expect(result.locatedAreas).toBe(0);
  });
});