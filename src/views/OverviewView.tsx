import { useMemo, useState } from 'react';
import type { SourceMode } from '../lib/dataSource';
import { useAsync } from '../lib/useAsync';
import {
  fuelMix,
  overviewKpis,
  registrationsByYear,
  topBrands,
  odometerVerdictMix,
  typeByPeriod,
  vehicleTypeMix,
} from '../data/queries';
import { ChartCard } from '../charts/ChartCard';
import { LineChart, type LinePoint } from '../charts/LineChart';
import { BarChart } from '../charts/BarChart';
import { Heatmap } from '../charts/Heatmap';
import { StatTile } from '../charts/Figures';
import { Gauge, Odometer, Telltale, TelltalePanel } from '../charts/Instruments';
import { compact, num, num1, percent, tick } from '../lib/format';
import { fuelColour, seriesVar } from '../lib/palette';
import {
  fetchCbsVehiclePark,
  fetchCbsRoadEmissions,
  fetchCbsFuelPrices,
  fetchCbsRoadDeaths,
  EXTERNAL_SOURCES,
} from '../lib/externalApi';

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
  const odometer = useAsync((signal) => odometerVerdictMix({ mode, signal }), [mode]);

  /* CBS benchmark: the *active* fleet (vehicles that actually drove last year)
     against the register's full count. Optional, cached, national. */
  const cbs = useAsync((signal) => fetchCbsVehiclePark(signal), []);

  /* National context from CBS and the RDW parking catalogue - same OData/SoQL
     shape as the benchmark, all live, all optional-cached. */
  const emissions = useAsync((signal) => fetchCbsRoadEmissions(signal), []);
  const prices = useAsync((signal) => fetchCbsFuelPrices(signal), []);
  const deaths = useAsync((signal) => fetchCbsRoadDeaths(signal), []);

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

  /* CBS categories map onto the dashboard's own register counts. Not every
     category has a registered counterpart; those get a "–" in the RDW column. */
  const benchRows = useMemo(() => {
    const k = kpis.data ?? null;
    const match = (label: string): number | null => {
      if (!k) return null;
      if (label.startsWith('Totaal actief')) return k.total;
      if (label.startsWith('Personenauto')) return k.passengerCars;
      return null;
    };
    const rows = cbs.data ?? [];
    return rows.slice(0, 6).map((d) => {
      const rdw = match(d.label);
      const distance = rdw != null && d.count > 0 ? (d.count - rdw) / d.count : null;
      return {
        label: d.label,
        rdw,
        cbs: d.count,
        distance,
        fill: d.count > 0 && rdw != null ? Math.min(100, Math.max(4, (rdw / d.count) * 100)) : 100,
      };
    });
  }, [cbs.data, kpis.data]);

  /* Share of *judged* vehicles whose odometer series does not add up. The
     denominator is deliberately the judged set, not the whole fleet: a vehicle
     with too few readings has no verdict, and counting it as "fine" would
     flatter the number. */
  const illogicalOdometer = useMemo(() => {
    const rows = odometer.data ?? [];
    if (rows.length === 0) return null;
    const judged = rows.reduce((sum, row) => sum + row.count, 0);
    const bad = rows
      .filter((row) => row.label.toLowerCase().includes('onlogisch'))
      .reduce((sum, row) => sum + row.count, 0);
    return judged > 0 ? bad / judged : null;
  }, [odometer.data]);

  /* National context, CBS tables. CO2 ships in million kg; the chart reads in
     megaton, so values are divided by 1000 at the boundary. */
  const co2Trend = useMemo(
    () => (emissions.data?.series ?? []).map((d) => ({ x: d.year, y: d.co2MlnKg / 1000 })),
    [emissions.data],
  );

  const co2ByCategory = useMemo(
    () =>
      (emissions.data?.byCategory ?? [])
        .slice(0, 6)
        .map((d) => ({ label: d.label, value: d.co2MlnKg / 1000 })),
    [emissions.data],
  );

  const priceChart = useMemo(() => {
    const rows = prices.data ?? [];
    const labelOf = (period: string): string => `${period.slice(0, 4)}·K${period.slice(-2)}`;
    const seriesOf = (key: 'benzine' | 'diesel' | 'lpg' | 'elektrisch'): LinePoint[] =>
      rows.map((row, i) => ({ x: i, y: row[key] }));
    return {
      labels: rows.map((row) => labelOf(row.period)),
      series: [
        { key: 'benzine', label: 'Benzine Euro95', colour: seriesVar(0), points: seriesOf('benzine') },
        { key: 'diesel', label: 'Diesel', colour: seriesVar(1), points: seriesOf('diesel') },
        { key: 'lpg', label: 'Lpg', colour: seriesVar(2), points: seriesOf('lpg') },
        { key: 'elektrisch', label: 'Elektriciteit', colour: seriesVar(3), points: seriesOf('elektrisch') },
      ],
    };
  }, [prices.data]);

  const deathsTrend = useMemo(
    () => (deaths.data?.series ?? []).map((d) => ({ x: d.year, y: d.count })),
    [deaths.data],
  );

  const deathsByMode = useMemo(
    () => (deaths.data?.byMode ?? []).slice(0, 6).map((d) => ({ label: d.label, value: d.count })),
    [deaths.data],
  );

  return (
    <>
      {/* The cluster. A register only counts up, so the headline total is an
          odometer; the bounded ratios are dials with a real scale and, where
          the direction means danger, a redline. */}
      <section className="cluster">
        <div className="cluster__binnacle">
          <Odometer
            label="Kentekenregister"
            value={total}
            format={num}
            caption="Elk voertuig met een Nederlands kenteken, van personenauto tot oplegger. Dit is de spil waaraan alle andere RDW-datasets hangen."
          />
          <TelltalePanel>
            <Telltale
              kind="recall"
              label="Terugroepactie"
              lit={(kpis.data?.openRecalls ?? 0) > 0}
              level="serious"
              value={compact(kpis.data?.openRecalls)}
              detail="Voertuigen met een openstaande actie van de fabrikant"
            />
            <Telltale
              kind="insurance"
              label="Geen WAM-dekking"
              lit={(kpis.data?.uninsured ?? 0) > 0}
              level="critical"
              value={compact(kpis.data?.uninsured)}
              detail="Wettelijk verplichte verzekering ontbreekt"
            />
          </TelltalePanel>
        </div>

        <div className="cluster__dials">
          <Gauge
            label="Elektrisch"
            value={electricShare}
            max={0.5}
            format={(v) => percent(v)}
            tone="good"
            caption="Aandeel elektrische brandstofregels in de vloot"
          />
          <Gauge
            label="Terugroepacties"
            value={recallShare}
            max={0.1}
            redlineFrom={0.05}
            format={(v) => percent(v)}
            tone="serious"
            caption="Openstaand bij de fabrikant"
          />
          <Gauge
            label="Tellerstand onlogisch"
            value={illogicalOdometer}
            max={0.1}
            redlineFrom={0.05}
            format={(v) => percent(v)}
            tone="critical"
            caption="Van de voertuigen waarover de RDW een oordeel geeft"
          />
          <Gauge
            label="Onverzekerd"
            value={uninsuredShare}
            max={0.1}
            redlineFrom={0.05}
            format={(v) => percent(v)}
            tone="critical"
            caption="Zonder WAM-dekking op de weg"
          />
        </div>
      </section>

      <section className="section">
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

      <section className="section">
        <div className="section__head">
          <p className="eyebrow">IJking tegen het CBS</p>
          <h2 className="section__title">Geregistreerd, of ook echt actief</h2>
          <p className="section__lede">
            RDW telt elk geregistreerd kenteken. Het CBS telt het{' '}
            <em>actieve</em> park: voertuigen die in het jaar daarvoor ook daadwerkelijk in het
            verkeer waren. Het verschil tussen de twee tells is dus geen fout — het is de afstand
            tussen het register en de weg.
          </p>
        </div>
        <div className="grid">
          <ChartCard
            title="Register tegen actief park"
            subtitle="CBS StatLine tafel 85243NED, laatst berekende periode — het dashboard leest het register zelf"
            sources={['vehicles', EXTERNAL_SOURCES.cbsStatLine]}
            span="full"
            loading={cbs.loading}
            refreshing={cbs.refreshing}
            error={cbs.error}
            note="Het CBS telt op 1 januari van het jaar ná de meting, en een voertuig dat het hele voorgaande jaar onverzekerd was gaat niet mee. Daardoor ligt het CBS-cijfer structureel iets lager dan het register-cijfer."
            table={{
              columns: ['Categorie', 'RDW-register', 'CBS actief park', 'Verschil'],
              rows: benchRows.map((d) => [
                d.label,
                d.rdw == null ? '–' : compact(d.rdw),
                compact(d.cbs),
                d.distance == null ? '–' : `${num1(d.distance * 100)}%`,
              ]),
            }}
          >
            {benchRows.length > 0 ? (
              <div className="benchmark">
                {benchRows.map((d) => (
                  <div className="benchmark__row" key={d.label}>
                    <span className="benchmark__label">{d.label}</span>
                    <span className="benchmark__value">
                      {d.rdw == null ? '–' : compact(d.rdw)}
                      <span className="benchmark__src">RDW</span>
                    </span>
                    <span className="benchmark__bar" aria-hidden="true">
                      <span className="benchmark__fill" style={{ width: `${d.fill}%` }} />
                    </span>
                    <span className="benchmark__value">
                      {compact(d.cbs)}
                      <span className="benchmark__src">CBS</span>
                    </span>
                    <span className="benchmark__delta">
                      {d.distance == null
                        ? '–'
                        : d.distance >= 0
                          ? `${num1(d.distance * 100)}% meer in het register`
                          : `${num1(Math.abs(d.distance) * 100)}% minder actief`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="chart-empty">
                De CBS-tafel antwoordde niet. De landelijke cijfers zijn daardoor niet beschikbaar;
                de rest van dit overzicht is gewoon berekend.
              </p>
            )}
          </ChartCard>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <p className="eyebrow">Landelijke context</p>
          <h2 className="section__title">Het wegverkeer, buiten het register</h2>
          <p className="section__lede">
            Het register vertelt wat er staat geregistreerd. Deze cijfers vertellen wat het wegverkeer{' '}
            <em>doet</em>: hoeveel CO₂ het uitstoot, wat een liter kost en wat verkeer aan levens kost.{' '}
            Allemaal CBS-publieke statistiek (CC-BY 4.0), los van de live/demo-schakelaar gelezen.
          </p>
        </div>
        <div className="grid">
          <ChartCard
            title="CO₂ door het wegverkeer"
            subtitle={`Totaal over de hele vloot, ${emissions.data?.series.length ?? 0} jaar reeks — het register telt voertuigen, het CBS telt hun uitstoot`}
            sources={[EXTERNAL_SOURCES.cbsEmissions]}
            span="full"
            loading={emissions.loading}
            refreshing={emissions.refreshing}
            error={emissions.error}
            table={{
              columns: ['Jaar', 'CO₂ (megaton)'],
              rows: co2Trend.map((d) => [String(d.x), Number(d.y.toFixed(1))]),
            }}
            note="CBS-tafel 85347NED meet de feitelijke emissies door het verbranden van brandstof (in mln kg, hier omgerekend naar megaton). De balken daaronder splitsen het laatste jaar per voertuigsoort."
          >
            <LineChart
              series={[
                { key: 'co2', label: 'CO₂', colour: 'var(--series-1)', points: co2Trend },
              ]}
              area
              height={260}
              formatY={tick}
              formatExact={num1}
              unit="Mt"
            />
            {co2ByCategory.length > 1 ? (
              <BarChart
                data={co2ByCategory}
                formatValue={num1}
                labelWidth={150}
                rowHeight={26}
              />
            ) : null}
          </ChartCard>

          <ChartCard
            title="Pompprijzen per kwartaal"
            subtitle="Inclusief accijns en btw — sinds 2020"
            sources={[EXTERNAL_SOURCES.cbsFuelPrices]}
            legend={priceChart.series.map((s) => ({ label: s.label, colour: s.colour, shape: 'line' as const }))}
            span="half"
            loading={prices.loading}
            refreshing={prices.refreshing}
            error={prices.error}
            table={{
              columns: ['Kwartaal', 'Benzine', 'Diesel', 'Lpg', 'Elektriciteit'],
              rows: (prices.data ?? []).map((r) => [
                `${r.period.slice(0, 4)}·K${r.period.slice(-2)}`,
                r.benzine ?? 0,
                r.diesel ?? 0,
                r.lpg ?? 0,
                r.elektrisch ?? 0,
              ]),
            }}
            note="Benzine, diesel en lpg in euro per liter; elektriciteit in euro per kWh — de reeksen zijn dus wel vergelijkbaar, de eenheid niet."
          >
            <LineChart
              series={priceChart.series}
              height={300}
              formatY={(v) => num1(v)}
              formatExact={(v) => num1(v)}
              formatX={(v) => priceChart.labels[Math.round(v)] ?? ''}
              unit="€"
            />
          </ChartCard>

          <ChartCard
            title="Verkeersdoden per jaar"
            subtitle={`CBS telt doden die binnen 30 dagen na het ongeval overleden`}
            sources={[EXTERNAL_SOURCES.cbsRoadDeaths]}
            span="half"
            loading={deaths.loading}
            refreshing={deaths.refreshing}
            error={deaths.error}
            table={{
              columns: ['Jaar', 'Verkeersdoden'],
              rows: deathsTrend.map((d) => [String(d.x), d.y]),
            }}
            note={`${deaths.data?.latestYear ?? 'Het recentste jaar'} vielen ${num(deaths.data?.latestTotal)} doden${deathsByMode[0] ? `, de meeste onder ${deathsByMode[0].label.toLowerCase()}s (${num(deathsByMode[0].value)})` : ''}.`}
          >
            <LineChart
              series={[
                { key: 'doden', label: 'Verkeersdoden', colour: 'var(--series-2)', points: deathsTrend },
              ]}
              area
              height={220}
              formatY={tick}
              formatExact={num}
              unit="doden"
            />
            {deathsByMode.length > 1 ? (
              <BarChart
                data={deathsByMode}
                formatValue={num}
                labelWidth={160}
                rowHeight={24}
              />
            ) : null}
          </ChartCard>
        </div>
      </section>
    </>
  );
}
