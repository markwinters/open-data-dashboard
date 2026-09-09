import { describe, expect, it } from 'vitest';
import { runSoql, type Row } from '../mock/soqlEngine';
import { and, between, eq, inList, lit, notNull, queryKey, toSearchParams } from '../lib/soql';

/**
 * The demo backend answers the same SoQL the live client sends, so a bug here
 * would show up as plausible-looking wrong numbers rather than an error. These
 * cases pin the subset the dashboard actually relies on.
 */
const rows: Row[] = [
  { kenteken: 'AA01BB', merk: 'VOLKSWAGEN', voertuigsoort: 'Personenauto', massa: '1200', datum: '2019-04-02T00:00:00.000' },
  { kenteken: 'AA02BB', merk: 'VOLKSWAGEN', voertuigsoort: 'Personenauto', massa: '1400', datum: '2021-07-19T00:00:00.000' },
  { kenteken: 'CC03DD', merk: 'TESLA', voertuigsoort: 'Personenauto', massa: '1900', datum: '2021-01-05T00:00:00.000' },
  { kenteken: 'EE04FF', merk: 'FORD', voertuigsoort: 'Bedrijfsauto', massa: '', datum: '2015-11-30T00:00:00.000' },
  { kenteken: 'GG05HH', merk: 'FORD', voertuigsoort: 'Bedrijfsauto', massa: '2200', datum: null },
];

describe('projection', () => {
  it('selects named columns and honours aliases', () => {
    const result = runSoql(rows, { select: 'kenteken, merk AS marque', limit: 2 });
    expect(result).toEqual([
      { kenteken: 'AA01BB', marque: 'VOLKSWAGEN' },
      { kenteken: 'AA02BB', marque: 'VOLKSWAGEN' },
    ]);
  });

  it('treats an empty string as null, the way Socrata does', () => {
    const result = runSoql(rows, { select: 'kenteken, massa', where: notNull('massa') });
    expect(result.map((r) => r.kenteken)).toEqual(['AA01BB', 'AA02BB', 'CC03DD', 'GG05HH']);
  });
});

describe('predicates', () => {
  it('compares numerically when either side is a number', () => {
    const result = runSoql(rows, { select: 'kenteken', where: 'massa > 1300' });
    // String comparison would put '1200' above '1300'; numeric comparison must not.
    expect(result.map((r) => r.kenteken)).toEqual(['AA02BB', 'CC03DD', 'GG05HH']);
  });

  it('handles AND, OR and parentheses', () => {
    const where = and(eq('voertuigsoort', 'Personenauto'), "merk = 'TESLA' OR massa < 1300");
    const result = runSoql(rows, { select: 'kenteken', where });
    expect(result.map((r) => r.kenteken)).toEqual(['AA01BB', 'CC03DD']);
  });

  it('supports in-lists and escapes quotes in literals', () => {
    const result = runSoql(rows, { select: 'kenteken', where: inList('merk', ['FORD', 'TESLA']) });
    expect(result).toHaveLength(3);
    expect(lit("O'Brien")).toBe("'O''Brien'");
  });

  it('never matches on an empty in-list', () => {
    expect(runSoql(rows, { where: inList('merk', []) })).toHaveLength(0);
  });

  it('filters on a year extracted from a floating timestamp', () => {
    const result = runSoql(rows, {
      select: 'kenteken',
      where: between('date_extract_y(datum)', 2019, 2021),
    });
    expect(result.map((r) => r.kenteken)).toEqual(['AA01BB', 'AA02BB', 'CC03DD']);
  });

  it('supports starts_with, which the plate search depends on', () => {
    const result = runSoql(rows, { select: 'kenteken', where: `starts_with(kenteken, ${lit('AA')})` });
    expect(result).toHaveLength(2);
  });

  it('excludes rows whose value is null from every comparison', () => {
    expect(runSoql(rows, { where: 'date_extract_y(datum) >= 1900' })).toHaveLength(4);
  });
});

describe('aggregation', () => {
  it('counts all rows for count(*)', () => {
    expect(runSoql(rows, { select: 'count(*) AS n' })).toEqual([{ n: 5 }]);
  });

  it('counts non-null values when a column is named', () => {
    expect(runSoql(rows, { select: 'count(massa) AS n' })).toEqual([{ n: 4 }]);
  });

  it('groups and orders, and orders by the select alias', () => {
    const result = runSoql(rows, {
      select: 'merk, count(1) AS n',
      group: 'merk',
      order: 'n DESC, merk',
    });
    // The tie on n=2 is broken by the second term, merk ascending.
    expect(result).toEqual([
      { merk: 'FORD', n: 2 },
      { merk: 'VOLKSWAGEN', n: 2 },
      { merk: 'TESLA', n: 1 },
    ]);
  });

  it('groups on two keys, including a function', () => {
    const result = runSoql(rows, {
      select: 'voertuigsoort, date_extract_y(datum) AS jaar, count(1) AS n',
      where: notNull('datum'),
      group: 'voertuigsoort, date_extract_y(datum)',
      order: 'jaar',
    });
    expect(result).toEqual([
      { voertuigsoort: 'Bedrijfsauto', jaar: 2015, n: 1 },
      { voertuigsoort: 'Personenauto', jaar: 2019, n: 1 },
      { voertuigsoort: 'Personenauto', jaar: 2021, n: 2 },
    ]);
  });

  it('averages over the non-null values only', () => {
    const result = runSoql(rows, { select: 'avg(massa) AS gemiddelde' });
    expect(result[0]!.gemiddelde).toBeCloseTo((1200 + 1400 + 1900 + 2200) / 4);
  });

  it('applies having after grouping', () => {
    const result = runSoql(rows, {
      select: 'merk, count(1) AS n',
      group: 'merk',
      having: 'n > 1',
      order: 'merk',
    });
    expect(result.map((r) => r.merk)).toEqual(['FORD', 'VOLKSWAGEN']);
  });
});

describe('paging', () => {
  it('applies limit and offset in order', () => {
    const page = runSoql(rows, { select: 'kenteken', order: 'kenteken', limit: 2, offset: 2 });
    expect(page.map((r) => r.kenteken)).toEqual(['CC03DD', 'EE04FF']);
  });

  it('defaults to Socrata’s 1000-row page when no limit is given', () => {
    expect(runSoql(rows, {}).length).toBe(5);
  });
});

describe('failure modes', () => {
  it('throws on an unsupported function rather than returning wrong numbers', () => {
    expect(() => runSoql(rows, { select: 'within_circle(x) AS n' })).toThrow(/unsupported function/);
  });
});

describe('query serialisation', () => {
  it('writes the $-prefixed parameters Socrata expects', () => {
    const params = toSearchParams({ select: 'count(1) AS n', where: "merk = 'FORD'", limit: 5 });
    expect(params.get('$select')).toBe('count(1) AS n');
    expect(params.get('$where')).toBe("merk = 'FORD'");
    expect(params.get('$limit')).toBe('5');
  });

  it('produces one cache key regardless of the order fields were set', () => {
    const a = queryKey('m9d7-ebf2', { select: 'kenteken', where: 'massa > 1', limit: 5 });
    const b = queryKey('m9d7-ebf2', { limit: 5, where: 'massa > 1', select: 'kenteken' });
    expect(a).toBe(b);
  });
});
