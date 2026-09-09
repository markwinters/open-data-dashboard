import { useMemo, useState } from 'react';
import type { SourceMode } from '../lib/dataSource';
import { useAsync } from '../lib/useAsync';
import {
  fuelMix,
  overviewKpis,
  registrationsByYear,
  topBrands,
  typeByPeriod,
  vehicleTypeMix,
} from '../data/queries';
import { ChartCard } from '../charts/ChartCard';
import { LineChart } from '../charts/LineChart';
import { BarChart } from '../charts/BarChart';
import { Heatmap } from '../charts/Heatmap';
import { HeroFigure, Meter, StatTile } from '../charts/Figures';
import { compact, num, num1, percent, tick } from '../lib/format';
import { fuelColour } from '../lib/palette';

const CURRENT_YEAR = new Date().getFullYear();

const RANGES = [
  { label: '10 jaar', years: 10 },
  { label: '20 jaar', years: 20 },
  { label: '35 jaar', years: 35 },
] as const;

export function OverviewView({ mode }: { mode: SourceMode }) {
  const [rangeYears, setRangeYears] = useState<number>(20);
  const from = CURRENT_YEAR - rangeYears + 1;

  const kpis = useAsync((signal) => overviewKpis({ mode, signal }), [mode]);
  const registrations = useAsync(
    (signal) => registrationsByYear({ mode, signal }, from, CURRENT_YEAR),
    [mode, from],
  );
  const brands = useAsync((signal) => topBrands({ mode, signal }, 12), [mode]);
  const types = useAsync((signal) => vehicleTypeMix({ mode, signal }), [mode]);
  const fuels = useAsync((signal) => fuelMix({ mode, signal }), [mode]);
  const grid = useAsync((signal) => typeByPeriod({ mode, signal }, from, CURRENT_YEAR), [mode, from]);

  const total = kpis.data?.total ?? null;
  const series = registrations.data ?? [];

  /* The intake series doubles as the sparkline behind the headline tiles. */
  const trend = useMemo(() => series.slice(-12).map((d) => d.count), [series]);

  const lastFull = series.length >= 2 ? series[series.length - 2] : undefined;
  const priorFull = series.length >= 3 ? series[series.length - 3] : undefined;
  const intakeDelta =
    lastFull && priorFull && priorFull.count > 0
      ? (lastFull.count - priorFull.count) / priorFull.count
      : null;

  /* Five-year bands keep the heatmap readable; a column per year would not be. */
  const heat = useMemo(() => {
    const rows = grid.data ?? [];
    if (rows.length === 0) return null;
    const bandOf = (year: number) => `${Math.floor(year / 5) * 5}`;
    const columns = [...new Set(rows.map((r) => bandOf(r.year)))].sort();
    const totalsByType = new Map<string, number>();
    const cells = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.type}|${bandOf(row.year)}`;
      cells.set(key, (cells.get(key) ?? 0) + row.count);
      totalsByType.set(row.type, (totalsByType.get(row.type) ?? 0) + row.count);
    }
    const typeRows = [...totalsByType.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type]) => type);
    return {
      rows: typeRows,
      columns: columns.map((c) => `${c}–${Number(c) + 4}`),
      cells: typeRows.flatMap((type) =>
        columns.map((c) => ({
          row: type,
          column: `${c}–${Number(c) + 4}`,
          value: cells.get(`${type}|${c}`) ?? null,
        })),
      ),
    };
  }, [grid.data]);

  const electricShare =
    kpis.data?.electricRows != null && total ? kpis.data.electricRows / total : null;
  const recallShare = kpis.data?.openRecalls != null && total ? kpis.data.openRecalls / total : null;
  const uninsuredShare = kpis.data?.uninsured != null && total ? kpis.data.uninsured / total : null;

  return (
    <>
      <section className="hero-band">
        <HeroFigure
          label="Voertuigen in het kentekenregister"
          value={total == null ? '—' : num(total)}
          caption="Elk voertuig met een Nederlands kenteken, van personenauto tot oplegger. Dit is de spil waaraan alle andere RDW-datasets hangen."
        />
        <div className="stat-grid">
          <StatTile
            label="Personenauto's"
            value={compact(kpis.data?.passengerCars)}
            hint={
              kpis.data?.passengerCars != null && total
                ? `${percent(kpis.data.passengerCars / total)} van de vloot`
                : undefined
            }
            loading={kpis.loading}
          />
          <StatTile
            label={`Eerste toelatingen in ${lastFull?.year ?? CURRENT_YEAR - 1}`}
            value={compact(lastFull?.count)}
            delta={
              intakeDelta == null
                ? undefined
                : {
                    text: `${intakeDelta > 0 ? '+' : ''}${num1(intakeDelta * 100)}% vs ${priorFull?.year}`,
                    direction: intakeDelta > 0 ? 'up' : intakeDelta < 0 ? 'down' : 'flat',
                    upIsGood: true,
                  }
            }
            trend={trend}
            loading={registrations.loading}
          />
          <StatTile
            label="Openstaande terugroepacties"
            value={compact(kpis.data?.openRecalls)}
            hint={recallShare == null ? undefined : `${percent(recallShare)} van de vloot`}
            loading={kpis.loading}
          />
          <StatTile
            label="Niet WAM-verzekerd"
            value={compact(kpis.data?.uninsured)}
            hint={uninsuredShare == null ? undefined : `${percent(uninsuredShare)} van de vloot`}
            loading={kpis.loading}
          />
        </div>
      </section>

      <section className="section">
        <div className="meter-grid">
          <Meter
            label="Elektrische brandstofregels"
            fraction={electricShare ?? 0}
            valueText={percent(electricShare)}
            level="good"
            statusText="Aandeel van de vloot met een elektrische aandrijflijn"
          />
          <Meter
            label="Openstaande terugroepactie"
            fraction={(recallShare ?? 0) * 10}
            valueText={percent(recallShare)}
            level={recallShare != null && recallShare > 0.05 ? 'serious' : 'warning'}
            statusText="Fabrikant heeft een actie uitstaan (schaal 0–10%)"
          />
          <Meter
            label="Zonder WAM-dekking"
            fraction={(uninsuredShare ?? 0) * 10}
            valueText={percent(uninsuredShare)}
            level={uninsuredShare != null && uninsuredShare > 0.05 ? 'critical' : 'warning'}
            statusText="Wettelijk verplichte verzekering ontbreekt (schaal 0–10%)"
          />
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <p className="eyebrow">Periode</p>
          <h2 className="section__title">Instroom door de tijd</h2>
          <p className="section__lede">
            Het jaar van eerste toelating is de enige datum die elk voertuig heeft. Alles onder deze
            filterrij is op dezelfde periode gesneden.
          </p>
        </div>

        <div className="filters" style={{ marginBottom: 16 }}>
          <div className="field">
            <span className="field__label">Bouwjaren</span>
            <div className="segmented" role="group" aria-label="Periode">
              {RANGES.map((range) => (
                <button
                  key={range.years}
                  type="button"
                  aria-pressed={rangeYears === range.years}
                  onClick={() => setRangeYears(range.years)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div className="filters__spacer" />
          <p className="filters__summary">
            <strong>
              {from}–{CURRENT_YEAR}
            </strong>
            <br />
            {series.length > 0 ? `${num(series.reduce((s, d) => s + d.count, 0))} voertuigen` : ' '}
          </p>
        </div>

        <div className="grid">
          <ChartCard
            title="Eerste toelatingen per jaar"
            subtitle="Voertuigen die in dat jaar voor het eerst op de Nederlandse weg werden toegelaten"
            sources={['vehicles']}
            span="full"
            loading={registrations.loading}
            refreshing={registrations.refreshing}
            error={registrations.error}
            note="Het lopende jaar is per definitie onvolledig: het telt alleen de maanden die al verstreken zijn."
            table={{
              columns: ['Jaar', 'Eerste toelatingen'],
              rows: series.map((d) => [String(d.year), d.count]),
            }}
          >
            <LineChart
              height={280}
              area
              series={[
                {
                  key: 'toelatingen',
                  label: 'Toelatingen',
                  colour: 'var(--series-1)',
                  points: series.map((d) => ({ x: d.year, y: d.count })),
                },
              ]}
              formatY={tick}
              formatExact={num}
              formatX={(v) => String(v)}
              unit="voertuigen"
            />
          </ChartCard>

          <ChartCard
            title="Voertuigsoort tegen bouwjaar"
            subtitle="Waar elke soort in de tijd zit — sterker gekleurd is meer voertuigen"
            sources={['vehicles']}
            span="two-thirds"
            loading={grid.loading}
            refreshing={grid.refreshing}
            error={grid.error}
            table={{
              columns: ['Voertuigsoort', 'Periode', 'Aantal'],
              rows: (heat?.cells ?? [])
                .filter((c) => c.value != null)
                .map((c) => [c.row, c.column, c.value as number]),
            }}
          >
            {heat ? (
              <Heatmap
                rows={heat.rows}
                columns={heat.columns}
                cells={heat.cells}
                scaleLabel="voertuigen"
                columnLabel="bouwjaren"
                formatValue={compact}
                formatExact={num}
              />
            ) : (
              <p className="chart-empty">Geen waarden in deze selectie.</p>
            )}
          </ChartCard>

          <ChartCard
            title="Voertuigsoorten"
            subtitle="De hele registratie, niet alleen de gekozen periode"
            sources={['vehicles']}
            span="third"
            loading={types.loading}
            refreshing={types.refreshing}
            error={types.error}
            table={{
              columns: ['Soort', 'Aantal'],
              rows: (types.data ?? []).map((d) => [d.label, d.count]),
            }}
          >
            <BarChart
              data={(types.data ?? []).slice(0, 8).map((d) => ({ label: d.label, value: d.count }))}
              formatValue={compact}
              formatExact={num}
              labelWidth={120}
            />
          </ChartCard>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <p className="eyebrow">Samenstelling</p>
          <h2 className="section__title">Waaruit de vloot bestaat</h2>
        </div>
        <div className="grid">
          <ChartCard
            title="Grootste merken"
            subtitle="Personenauto's per merk, over de hele registratie"
            sources={['vehicles']}
            span="two-thirds"
            loading={brands.loading}
            refreshing={brands.refreshing}
            error={brands.error}
            table={{
              columns: ['Merk', 'Personenauto’s'],
              rows: (brands.data ?? []).map((d) => [d.label, d.count]),
            }}
          >
            <BarChart
              data={(brands.data ?? []).map((d) => ({ label: d.label, value: d.count }))}
              formatValue={compact}
              formatExact={num}
              labelWidth={130}
            />
          </ChartCard>

          <ChartCard
            title="Brandstofsoorten"
            subtitle="Brandstofregels, niet voertuigen — een hybride telt twee keer"
            sources={['fuel']}
            span="third"
            loading={fuels.loading}
            refreshing={fuels.refreshing}
            error={fuels.error}
            note="Deze kleuren keren terug op het tabblad Verbonden analyse: elke brandstof houdt daar dezelfde tint."
            table={{
              columns: ['Brandstof', 'Regels'],
              rows: (fuels.data ?? []).map((d) => [d.label, d.count]),
            }}
          >
            <BarChart
              data={(fuels.data ?? [])
                .slice(0, 7)
                .map((d) => ({ label: d.label, value: d.count, colour: fuelColour(d.label) }))}
              formatValue={compact}
              formatExact={num}
              labelWidth={104}
            />
          </ChartCard>
        </div>
      </section>
    </>
  );
}
