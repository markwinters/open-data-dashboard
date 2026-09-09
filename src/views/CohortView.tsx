import { useMemo, useState } from 'react';
import type { SourceMode } from '../lib/dataSource';
import { useAsync } from '../lib/useAsync';
import { loadCohort, marqueOptions, type CohortFilters, type CohortVehicle } from '../data/queries';
import { ChartCard } from '../charts/ChartCard';
import { StackedColumnChart } from '../charts/StackedColumnChart';
import { ScatterChart } from '../charts/ScatterChart';
import { BarChart } from '../charts/BarChart';
import { Heatmap } from '../charts/Heatmap';
import { LineChart } from '../charts/LineChart';
import { StatTile } from '../charts/Figures';
import { POWERTRAIN_ORDER, powertrainColour, seriesVar } from '../lib/palette';
import { compact, euro, num, num1, percent, tick, titleCase } from '../lib/format';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 36 }, (_, i) => CURRENT_YEAR - i);
const SAMPLES = [500, 1500, 4000] as const;

/**
 * Scatter uses the all-pairs pairlist, which caps this palette at three series,
 * so the six powertrains fold into three buckets there. The buckets keep the
 * hues their powertrains already have, so nothing changes colour between charts.
 */
const SCATTER_GROUPS = [
  { key: 'Benzine', label: 'Benzine', colour: seriesVar(0) },
  { key: 'Diesel', label: 'Diesel', colour: seriesVar(1) },
  { key: 'Elektrisch', label: 'Elektrisch of hybride', colour: seriesVar(2) },
];

const scatterBucket = (vehicle: CohortVehicle): string | null => {
  switch (vehicle.powertrain) {
    case 'Benzine':
      return 'Benzine';
    case 'Diesel':
      return 'Diesel';
    case 'Elektrisch':
    case 'Plug-in hybride':
      return 'Elektrisch';
    default:
      return null;
  }
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

export function CohortView({ mode }: { mode: SourceMode }) {
  const [filters, setFilters] = useState<CohortFilters>({
    marque: null,
    yearFrom: CURRENT_YEAR - 15,
    yearTo: CURRENT_YEAR,
    vehicleType: 'Personenauto',
    sampleSize: 1500,
  });

  const marques = useAsync((signal) => marqueOptions({ mode, signal }, 40), [mode]);
  const cohort = useAsync(
    (signal) => loadCohort({ mode, signal }, filters),
    [mode, filters.marque, filters.yearFrom, filters.yearTo, filters.vehicleType, filters.sampleSize],
  );

  const vehicles = useMemo(() => cohort.data?.vehicles ?? [], [cohort.data]);
  const defectNames = cohort.data?.defectNames ?? new Map<string, string>();

  const summary = useMemo(() => {
    const combustionCo2 = vehicles
      .filter((v) => v.powertrain !== 'Elektrisch' && v.co2 != null && v.co2 > 0)
      .map((v) => v.co2!);
    const electrified = vehicles.filter(
      (v) => v.powertrain === 'Elektrisch' || v.powertrain === 'Plug-in hybride',
    ).length;
    return {
      size: vehicles.length,
      avgCo2: mean(combustionCo2),
      electrifiedShare: vehicles.length > 0 ? electrified / vehicles.length : null,
      avgMass: mean(vehicles.map((v) => v.massEmpty).filter((v): v is number => v != null)),
      medianPrice: median(vehicles.map((v) => v.price).filter((v): v is number => v != null && v > 0)),
      withDefects: vehicles.filter((v) => v.defects.length > 0).length,
    };
  }, [vehicles]);

  /* Powertrain per build year - the join's headline: neither dataset says this alone. */
  const powertrainByYear = useMemo(() => {
    const byYear = new Map<number, Record<string, number>>();
    for (const vehicle of vehicles) {
      if (vehicle.year == null) continue;
      const bucket = byYear.get(vehicle.year) ?? {};
      bucket[vehicle.powertrain] = (bucket[vehicle.powertrain] ?? 0) + 1;
      byYear.set(vehicle.year, bucket);
    }
    return [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, values]) => ({ label: String(year), values }));
  }, [vehicles]);

  const scatterPoints = useMemo(
    () =>
      vehicles
        .map((vehicle) => {
          const group = scatterBucket(vehicle);
          if (!group || vehicle.massEmpty == null || vehicle.co2 == null) return null;
          // Battery-electric rows carry a CO2 of 0, which is true but says nothing
          // about the relationship this chart is about, so they sit out.
          if (vehicle.co2 <= 0) return null;
          return {
            x: vehicle.massEmpty,
            y: vehicle.co2,
            group,
            label: `${vehicle.merk} ${vehicle.model}`.trim(),
            detail: [
              { label: 'bouwjaar', value: vehicle.year == null ? '–' : String(vehicle.year) },
              { label: 'aandrijflijn', value: vehicle.powertrain },
            ],
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [vehicles],
  );

  const excludedFromScatter = vehicles.length - scatterPoints.length;

  /* Body type against powertrain - a third dataset entering the same join. */
  const bodyGrid = useMemo(() => {
    const counts = new Map<string, number>();
    const bodyTotals = new Map<string, number>();
    for (const vehicle of vehicles) {
      if (!vehicle.bodyType) continue;
      const body = titleCase(vehicle.bodyType.replace(/^[A-Z]{2}\s*-\s*/, ''));
      counts.set(`${body}|${vehicle.powertrain}`, (counts.get(`${body}|${vehicle.powertrain}`) ?? 0) + 1);
      bodyTotals.set(body, (bodyTotals.get(body) ?? 0) + 1);
    }
    const rows = [...bodyTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([body]) => body);
    const columns = POWERTRAIN_ORDER.filter((p) => vehicles.some((v) => v.powertrain === p));
    return {
      rows,
      columns: [...columns],
      cells: rows.flatMap((body) =>
        columns.map((p) => ({ row: body, column: p, value: counts.get(`${body}|${p}`) ?? null })),
      ),
    };
  }, [vehicles]);

  /* Inspection defects joined to the statutory lexicon that names them. */
  const topDefects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of vehicles) {
      for (const defect of vehicle.defects) {
        counts.set(defect.code, (counts.get(defect.code) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => {
        // The chart trims the label to whatever the card is wide enough for;
        // the untrimmed text stays in the tooltip and the table view.
        const description = defectNames.get(code) ?? 'Omschrijving niet in de gebrekenlijst';
        return { code, count, description };
      });
  }, [vehicles, defectNames]);

  const defectsByYear = useMemo(() => {
    const totals = new Map<number, { defects: number; vehicles: number }>();
    for (const vehicle of vehicles) {
      if (vehicle.year == null) continue;
      const bucket = totals.get(vehicle.year) ?? { defects: 0, vehicles: 0 };
      bucket.defects += vehicle.defects.length;
      bucket.vehicles += 1;
      totals.set(vehicle.year, bucket);
    }
    return [...totals.entries()]
      .filter(([, b]) => b.vehicles >= 5)
      .sort((a, b) => a[0] - b[0])
      .map(([year, b]) => ({ x: year, y: b.defects / b.vehicles }));
  }, [vehicles]);

  const set = <K extends keyof CohortFilters>(key: K, value: CohortFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const degraded = cohort.data?.degraded ?? [];

  return (
    <>
      <section className="section" style={{ marginTop: 4 }}>
        <div className="section__head">
          <p className="eyebrow">Verbonden analyse</p>
          <h2 className="section__title">Vier datasets, één steekproef</h2>
          <p className="section__lede">
            Socrata kent geen join over datasets heen. Deze weergave trekt daarom eerst een
            steekproef kentekens uit het register en haalt daarna per kenteken de brandstofregels,
            de carrosserie en de bij de APK geconstateerde gebreken op. Alles hieronder is op die
            samengevoegde steekproef gerekend — geen landelijke telling.
          </p>
        </div>

        <div className="filters">
          <label className="field">
            <span className="field__label">Merk</span>
            <select
              value={filters.marque ?? ''}
              onChange={(event) => set('marque', event.target.value || null)}
            >
              <option value="">Alle merken</option>
              {(marques.data ?? []).map((marque) => (
                <option key={marque} value={marque}>
                  {marque}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Voertuigsoort</span>
            <select
              value={filters.vehicleType}
              onChange={(event) => set('vehicleType', event.target.value)}
            >
              <option value="Personenauto">Personenauto</option>
              <option value="Bedrijfsauto">Bedrijfsauto</option>
              <option value="">Alle soorten</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">Bouwjaar van</span>
            <select
              value={filters.yearFrom}
              onChange={(event) => set('yearFrom', Number(event.target.value))}
            >
              {YEARS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">tot en met</span>
            <select
              value={filters.yearTo}
              onChange={(event) => set('yearTo', Number(event.target.value))}
            >
              {YEARS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span className="field__label">Steekproef</span>
            <div className="segmented" role="group" aria-label="Grootte van de steekproef">
              {SAMPLES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={filters.sampleSize === size}
                  onClick={() => set('sampleSize', size)}
                >
                  {num(size)}
                </button>
              ))}
            </div>
          </div>

          <div className="filters__spacer" />
          <p className="filters__summary">
            <strong>{num(summary.size)}</strong> voertuigen samengevoegd
            <br />
            uit <strong>{cohort.data?.matchingTotal == null ? '–' : num(cohort.data.matchingTotal)}</strong>{' '}
            die aan het filter voldoen
          </p>
        </div>

        {degraded.length > 0 ? (
          <p className="notice" style={{ marginTop: 12 }}>
            <span className="notice__icon" aria-hidden="true">
              ●
            </span>
            <span>
              <strong>Niet elke dataset antwoordde.</strong> De panelen die {degraded.join(' en ')}{' '}
              nodig hebben blijven leeg; de rest is gewoon berekend.
            </span>
          </p>
        ) : null}
      </section>

      <section className="section">
        <div className="stat-grid">
          <StatTile
            label="Gemiddelde CO₂-uitstoot"
            value={summary.avgCo2 == null ? '—' : `${num1(summary.avgCo2)} g/km`}
            hint="Alleen voertuigen met verbrandingsmotor"
            loading={cohort.loading}
          />
          <StatTile
            label="Elektrisch of hybride"
            value={percent(summary.electrifiedShare)}
            hint="Aandeel van de steekproef"
            loading={cohort.loading}
          />
          <StatTile
            label="Gemiddeld ledig gewicht"
            value={summary.avgMass == null ? '—' : `${num(summary.avgMass)} kg`}
            loading={cohort.loading}
          />
          <StatTile
            label="Mediane catalogusprijs"
            value={euro(summary.medianPrice)}
            hint="Nieuwprijs bij eerste toelating"
            loading={cohort.loading}
          />
          <StatTile
            label="Ooit een gebrek bij de APK"
            value={
              summary.size > 0 ? percent(summary.withDefects / summary.size) : '—'
            }
            hint={`${num(summary.withDefects)} van ${num(summary.size)} voertuigen`}
            loading={cohort.loading}
          />
        </div>
      </section>

      <section className="section">
        <div className="grid">
          <ChartCard
            title="Aandrijflijn per bouwjaar"
            subtitle="Afgeleid door de brandstofregels per kenteken samen te vouwen"
            sources={['vehicles', 'fuel']}
            span="full"
            loading={cohort.loading}
            refreshing={cohort.refreshing}
            error={cohort.error}
            legend={POWERTRAIN_ORDER.map((p) => ({
              label: p,
              colour: powertrainColour(p),
              shape: 'rect' as const,
            }))}
            note="Plug-in hybride staat in geen enkele RDW-dataset als waarde. Het volgt uit twee brandstofregels op hetzelfde kenteken — benzine én elektriciteit — en bestaat dus pas ná de koppeling."
            table={{
              columns: ['Bouwjaar', ...POWERTRAIN_ORDER],
              rows: powertrainByYear.map((column) => [
                column.label,
                ...POWERTRAIN_ORDER.map((p) => column.values[p] ?? 0),
              ]),
            }}
          >
            <StackedColumnChart
              columns={powertrainByYear}
              series={POWERTRAIN_ORDER.map((p) => ({
                key: p,
                label: p,
                colour: powertrainColour(p),
              }))}
              normalise
              height={300}
            />
          </ChartCard>

          <ChartCard
            title="CO₂-uitstoot tegen ledig gewicht"
            subtitle="Elk punt is één voertuig, gewicht uit het register, uitstoot uit de brandstofdataset"
            sources={['vehicles', 'fuel']}
            span="half"
            loading={cohort.loading}
            refreshing={cohort.refreshing}
            error={cohort.error}
            legend={SCATTER_GROUPS.map((g) => ({ label: g.label, colour: g.colour, shape: 'rect' as const }))}
            note={`Volledig elektrische voertuigen staan met 0 g/km geregistreerd en zouden de verhouding platslaan; zij en ${num(
              excludedFromScatter,
            )} voertuigen zonder uitstootwaarde blijven buiten deze grafiek.`}
            table={{
              columns: ['Voertuig', 'Ledig gewicht (kg)', 'CO₂ (g/km)', 'Aandrijflijn'],
              rows: scatterPoints
                .slice(0, 250)
                .map((p) => [p.label, p.x, p.y, p.detail?.[1]?.value ?? '']),
            }}
          >
            <ScatterChart
              points={scatterPoints}
              groups={SCATTER_GROUPS}
              xLabel="ledig gewicht (kg)"
              yLabel="CO₂ (g/km)"
              height={320}
              formatX={tick}
            />
          </ChartCard>

          <ChartCard
            title="Carrosserie tegen aandrijflijn"
            subtitle="Waar de elektrificatie in de steekproef daadwerkelijk zit"
            sources={['vehicles', 'fuel', 'body']}
            span="half"
            loading={cohort.loading}
            refreshing={cohort.refreshing}
            error={cohort.error}
            table={{
              columns: ['Carrosserie', 'Aandrijflijn', 'Voertuigen'],
              rows: bodyGrid.cells
                .filter((c) => c.value != null)
                .map((c) => [c.row, c.column, c.value as number]),
            }}
          >
            {bodyGrid.rows.length > 0 ? (
              <Heatmap
                rows={bodyGrid.rows}
                columns={bodyGrid.columns}
                cells={bodyGrid.cells}
                scaleLabel="voertuigen"
                cellHeight={34}
                labelWidth={124}
                formatValue={num}
              />
            ) : (
              <p className="chart-empty">Geen carrosseriegegevens in deze steekproef.</p>
            )}
          </ChartCard>

          <ChartCard
            title="Meest geconstateerde gebreken"
            subtitle="Gebrekcodes uit de APK, vertaald met de wettelijke gebrekenlijst"
            sources={['defectsFound', 'defectCodes']}
            span="half"
            loading={cohort.loading}
            refreshing={cohort.refreshing}
            error={cohort.error}
            note="De inspectiedataset geeft alleen een code zoals “RA0”. Pas de koppeling met de gebrekenlijst maakt er een zin van."
            table={{
              columns: ['Code', 'Omschrijving', 'Keer geconstateerd'],
              rows: topDefects.map((d) => [d.code, d.description, d.count]),
            }}
          >
            <BarChart
              data={topDefects.map((d) => ({
                label: d.description,
                value: d.count,
                detail: [
                  { label: 'code', value: d.code },
                  { label: 'gebrek', value: d.description },
                ],
              }))}
              formatValue={num}
              labelWidth={220}
              rowHeight={32}
            />
          </ChartCard>

          <ChartCard
            title="Gebreken per voertuig, naar bouwjaar"
            subtitle="Gemiddeld aantal geconstateerde gebreken per voertuig in de steekproef"
            sources={['vehicles', 'defectsFound']}
            span="half"
            loading={cohort.loading}
            refreshing={cohort.refreshing}
            error={cohort.error}
            note="Bouwjaren met minder dan vijf voertuigen in de steekproef zijn weggelaten: één auto zou de lijn dan bepalen."
            table={{
              columns: ['Bouwjaar', 'Gebreken per voertuig'],
              rows: defectsByYear.map((d) => [String(d.x), Number(d.y.toFixed(2))]),
            }}
          >
            <LineChart
              series={[
                {
                  key: 'gebreken',
                  label: 'Gebreken',
                  colour: 'var(--series-1)',
                  points: defectsByYear,
                },
              ]}
              area
              height={300}
              formatY={(v) => num1(v)}
              unit="per voertuig"
            />
          </ChartCard>
        </div>
      </section>

      <p className="notice">
        <span className="notice__icon" aria-hidden="true">
          ●
        </span>
        <span>
          <strong>Een steekproef, geen telling.</strong> De grafieken op dit tabblad zijn gerekend
          over {num(summary.size)} voertuigen die per kenteken zijn samengevoegd, niet over de{' '}
          {cohort.data?.matchingTotal == null ? 'volledige' : compact(cohort.data.matchingTotal)}{' '}
          voertuigen die aan het filter voldoen. Vergroot de steekproef voor een stabieler beeld.
        </span>
      </p>
    </>
  );
}
