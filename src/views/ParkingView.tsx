import { useMemo } from 'react';
import { useAsync } from '../lib/useAsync';
import { fetchParkingCatalog, EXTERNAL_SOURCES } from '../lib/externalApi';
import { ChartCard } from '../charts/ChartCard';
import { ScatterChart, type ScatterPoint } from '../charts/ScatterChart';
import { BarChart } from '../charts/BarChart';
import { StatTile } from '../charts/Figures';
import { compact, num, num1, titleCase } from '../lib/format';
import { seriesVar } from '../lib/palette';

/**
 * The RDW parkeergebieden are a star schema: named zones join their usage class
 * and a geometry point. Nothing is interesting alone; together they draw the
 * country's parking policy - where a municipality charges, where it regulates
 * with permits, and where zones have no reported use at all.
 */

const PARKING_GROUPS = [
  { key: 'Betaald parkeren', label: 'Betaald parkeren', colour: seriesVar(0) },
  { key: 'Vergunning', label: 'Vergunning', colour: seriesVar(1) },
  { key: 'Overig', label: 'Overig', colour: seriesVar(2) },
] as const;

/** A zone's primary use folds into three buckets so the map stays readable. */
const usageBucket = (label: string): string => {
  const lowered = label.toLowerCase();
  if (lowered.includes('betaald')) return 'Betaald parkeren';
  if (lowered.includes('vergun')) return 'Vergunning';
  return 'Overig';
};

/** The Netherlands, more or less. Keeps stray overseas coordinates off the map. */
const NL_BOUNDS = { lonMin: 3.2, lonMax: 7.3, latMin: 50.7, latMax: 53.6 };

export function ParkingView() {
  const parking = useAsync((signal) => fetchParkingCatalog(signal), []);
  const catalog = parking.data;

  const points = useMemo<ScatterPoint[]>(() => {
    const areas = catalog?.areas ?? [];
    return areas
      .filter(
        (area) =>
          area.longitude != null &&
          area.latitude != null &&
          area.longitude >= NL_BOUNDS.lonMin &&
          area.longitude <= NL_BOUNDS.lonMax &&
          area.latitude >= NL_BOUNDS.latMin &&
          area.latitude <= NL_BOUNDS.latMax,
      )
      .map((area) => {
        const primary = area.usages[0] ?? 'Overig';
        return {
          x: area.longitude!,
          y: area.latitude!,
          group: usageBucket(primary),
          label: titleCase(area.name),
          detail: [
            { label: 'gebruik', value: titleCase(primary) },
            { label: 'gebied', value: area.key },
          ],
        };
      });
  }, [catalog]);

  const usageBars = useMemo(
    () =>
      (catalog?.usageMix ?? [])
        .slice(0, 8)
        .map((row) => ({ label: titleCase(row.label), value: row.count })),
    [catalog],
  );

  const areas = catalog?.areas ?? [];
  const topUsage = catalog?.usageMix[0];

  return (
    <>
      <section className="section" style={{ marginTop: 4 }}>
        <div className="section__head">
          <p className="eyebrow">Parkeren</p>
          <h2 className="section__title">Waar Nederland parkeert</h2>
          <p className="section__lede">
            RDW beheert de landelijke catalogus van <em>parkeergebieden</em>: zones waar een
            gemeente tarief of vergunningsregels heeft vastgelegd. Het zijn beleidszones, geen
            parkeerplaatsen — vier losse datasets worden hier per kenteken-vrije sleutel
            samengevoegd tot één landkaart, onafhankelijk van de live/demo-schakelaar gelezen.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="stat-grid">
          <StatTile
            label="Parkeergebieden"
            value={compact(areas.length)}
            hint="Gedefinieerde zones in de RDW-catalogus"
            loading={parking.loading}
          />
          <StatTile
            label="Gelokaliseerd"
            value={compact(catalog?.locatedAreas)}
            hint="Zones met een coördinaat op de kaart"
            loading={parking.loading}
          />
          <StatTile
            label="Gebruiksvormen"
            value={num(catalog?.usageMix.length)}
            hint="Betaald, vergunning, P+R, …"
            loading={parking.loading}
          />
          <StatTile
            label="Meest voorkomend"
            value={topUsage ? titleCase(topUsage.label) : '—'}
            hint={topUsage ? `${compact(topUsage.count)} gebieden` : undefined}
            loading={parking.loading}
          />
        </div>
      </section>

      <section className="section">
        <div className="grid">
          <ChartCard
            title="Parkeergebieden op de kaart"
            subtitle={`Elke stip is een zone met coördinaten — ${num1(points.length)} van de ${compact(areas.length)} gelokaliseerde gebieden op het Nederlandse vasteland`}
            sources={[EXTERNAL_SOURCES.parking]}
            legend={PARKING_GROUPS.map((g) => ({ label: g.label, colour: g.colour, shape: 'rect' as const }))}
            span="full"
            loading={parking.loading}
            refreshing={parking.refreshing}
            error={parking.error}
            note="De stippen liggen op de coördinaten die RDW per zone publiceert (WKT-punten); Nederland verschijnt dus vanzelf. Een zone valt onder 'Betaald parkeren' als zijn primaire gebruiksvorm dat zegt, onder 'Vergunning' bij een vergunningstelsel — en onder 'Overig' als de catalogus er geen specifiek gebruik voor heeft."
            table={{
              columns: ['Gebied', 'Gebruik', 'Lengtegraad', 'Breedtegraad'],
              rows: areas
                .filter((a) => a.longitude != null && a.latitude != null)
                .slice(0, 300)
                .map((a) => [
                  titleCase(a.name),
                  titleCase(a.usages[0] ?? 'Overig'),
                  Number(num1(a.longitude!).replace(',', '.')),
                  Number(num1(a.latitude!).replace(',', '.')),
                ]),
            }}
          >
            {points.length === 0 ? (
              <p className="chart-empty">De parkeer-catalogus antwoordde niet. Zonder de vier gekoppelde datasets is er geen kaart.</p>
            ) : (
              <ScatterChart
                points={points}
                groups={[...PARKING_GROUPS]}
                xLabel="lengtegraad (°O)"
                yLabel="breedtegraad (°N)"
                height={420}
                formatX={(v) => num1(v)}
                formatY={(v) => num1(v)}
                formatExactX={(v) => num1(v)}
                formatExactY={(v) => num1(v)}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Meest voorkomende gebruiksvormen"
            subtitle="Primaire gebruik per zone, gewogen over de hele catalogus"
            sources={[EXTERNAL_SOURCES.parking]}
            span="half"
            loading={parking.loading}
            refreshing={parking.refreshing}
            error={parking.error}
            note="Een zone kan meerdere gebruiken kennen; geteld wordt de meest specifieke regel (de 'J'-specificaties uit de RDW-catalogus)."
            table={{
              columns: ['Gebruiksvorm', 'Gebieden'],
              rows: (catalog?.usageMix ?? []).slice(0, 8).map((row) => [titleCase(row.label), row.count]),
            }}
          >
            <BarChart
              data={usageBars}
              formatValue={compact}
              formatExact={num}
              labelWidth={170}
            />
          </ChartCard>
        </div>
      </section>
    </>
  );
}