import { describe, expect, it } from 'vitest';
import { plate, shortDate, titleCase, toNumber, compact, percent } from '../lib/format';
import {
  ALL_PAIRS_SERIES_CAP,
  POWERTRAIN_ORDER,
  classifyPowertrain,
  fuelColour,
  powertrainColour,
  sequential,
} from '../lib/palette';
import { readOdometerVerdict } from '../data/odometerVerdict';
import { describeRisk } from '../data/queries';

describe('licence plates', () => {
  it('groups a plate by the shape of its letters and digits', () => {
    expect(plate('BB00DZ')).toBe('BB-00-DZ');
    expect(plate('12ABC3')).toBe('12-ABC-3');
    expect(plate('1ABC23')).toBe('1-ABC-23');
  });

  it('leaves anything that is not six characters alone', () => {
    expect(plate('ABC')).toBe('ABC');
    expect(plate(null)).toBe('–');
  });

  it('accepts an already-punctuated plate', () => {
    expect(plate('bb-00-dz')).toBe('BB-00-DZ');
  });
});

describe('RDW value handling', () => {
  it('reads a floating timestamp as a Dutch date', () => {
    expect(shortDate('2021-06-04T00:00:00.000')).toBe('04-06-2021');
    expect(shortDate(null)).toBe('–');
  });

  it('parses numeric-as-string columns and rejects blanks', () => {
    expect(toNumber('1450')).toBe(1450);
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('n.v.t.')).toBeNull();
  });

  it('softens shouted code-list values but leaves mixed case intact', () => {
    expect(titleCase('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(titleCase('Ioniq 5')).toBe('Ioniq 5');
  });

  it('formats numbers the Dutch way', () => {
    expect(compact(1284)).toBe('1.284');
    expect(compact(12_900_000)).toBe('12,9 mln');
    expect(percent(0.062)).toBe('6,2%');
  });
});

describe('powertrain, derived across datasets', () => {
  it('reads two fuel rows on one plate as a plug-in hybrid', () => {
    // No RDW dataset carries this value; it exists only after the join.
    expect(classifyPowertrain(['Benzine', 'Elektriciteit'])).toBe('Plug-in hybride');
  });

  it('reads a lone electric row as battery-electric', () => {
    expect(classifyPowertrain(['Elektriciteit'])).toBe('Elektrisch');
  });

  it('falls back to Overig rather than inventing a category', () => {
    expect(classifyPowertrain(['Waterstof'])).toBe('Overig');
    expect(classifyPowertrain([])).toBe('Overig');
  });
});

describe('colour assignment', () => {
  it('keeps a category on its slot regardless of what else is on screen', () => {
    // "Colour follows the entity, never its rank" - filtering must not repaint.
    const dieselAlone = fuelColour('Diesel');
    expect(dieselAlone).toBe('var(--series-2)');
    expect(fuelColour('Benzine')).toBe('var(--series-1)');
    expect(fuelColour('Diesel')).toBe(dieselAlone);
  });

  it('gives every powertrain a distinct slot within the palette', () => {
    const colours = POWERTRAIN_ORDER.map(powertrainColour);
    expect(new Set(colours).size).toBe(POWERTRAIN_ORDER.length);
  });

  it('sends an unknown value to the last slot instead of generating a hue', () => {
    expect(fuelColour('Iets nieuws')).toBe('var(--series-7)');
  });

  it('caps all-pairs forms at three series', () => {
    expect(ALL_PAIRS_SERIES_CAP).toBe(3);
  });
});

describe('sequential ramp', () => {
  it('maps magnitude monotonically onto the ramp', () => {
    expect(sequential(0)).toBe('var(--seq-100)');
    expect(sequential(1)).toBe('var(--seq-700)');
    expect(sequential(-5)).toBe('var(--seq-100)');
    expect(sequential(Number.NaN)).toBe('var(--seq-100)');
  });
});

describe('odometer verdict', () => {
  it('lights red when the series does not add up', () => {
    const v = readOdometerVerdict('Onlogisch', '2024', '04');
    expect(v.lit).toBe(true);
    expect(v.level).toBe('critical');
    expect(v.year).toBe(2024);
    expect(v.reason).toMatch(/lager lag dan de vorige/);
  });

  it('stays dark on a logical series', () => {
    const v = readOdometerVerdict('Logisch', '2023', '00');
    expect(v.lit).toBe(false);
    expect(v.level).toBe('good');
  });

  it('treats a missing verdict as worth showing, not worth alarming about', () => {
    // Plenty of vehicles simply have too few readings to judge.
    const v = readOdometerVerdict('', null, null);
    expect(v.lit).toBe(false);
    expect(v.level).toBe('warning');
    expect(v.verdict).toBeNull();
    expect(v.year).toBeNull();
  });

  it('accepts an unpadded reason code', () => {
    expect(readOdometerVerdict('Geen oordeel', '2020', '2').reason).toMatch(/vervangen of gerepareerd/);
  });

  it('returns no reason for a code outside the statutory list', () => {
    expect(readOdometerVerdict('Geen oordeel', '2020', '99').reason).toBeNull();
  });
});

describe('recall risk column', () => {
  it('picks the prose column, whatever it is named', () => {
    // The risk dataset's column name is unconfirmed, so the reader goes by shape.
    expect(
      describeRisk({
        referentiecode_rdw: 'MGP128815',
        code: 'X41',
        omschrijving_risico: 'De brandstofleiding kan gaan lekken en brand veroorzaken.',
      }),
    ).toMatch(/brandstofleiding/);
  });

  it('never returns the join key or a bare code', () => {
    expect(describeRisk({ referentiecode_rdw: 'MGP128815', code: 'X41' })).toBeNull();
  });

  it('prefers the longest description when several columns qualify', () => {
    const picked = describeRisk({
      referentiecode_rdw: 'A',
      kort: 'Kan gaan lekken',
      lang: 'De brandstofleiding kan onder druk scheuren en brand veroorzaken.',
    });
    expect(picked).toMatch(/onder druk scheuren/);
  });
});
