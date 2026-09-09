import { useEffect, useMemo, useState } from 'react';
import type { SourceMode } from '../lib/dataSource';
import { useAsync } from '../lib/useAsync';
import { loadPassport, samplePlates } from '../data/queries';
import { ChartCard } from '../charts/ChartCard';
import { BarChart } from '../charts/BarChart';
import { Meter } from '../charts/Figures';
import { euro, num, num1, plate as formatPlate, shortDate, titleCase, toNumber } from '../lib/format';
import { powertrainColour } from '../lib/palette';
import type { Row } from '../mock/soqlEngine';

const value = (row: Row | undefined, field: string): string | null => {
  const v = row?.[field];
  return v === undefined || v === null || v === '' ? null : String(v);
};

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="spec">
      <p className="spec__label">{label}</p>
      <p className="spec__value">{children ?? '–'}</p>
    </div>
  );
}

export function PassportView({ mode }: { mode: SourceMode }) {
  const [input, setInput] = useState('');
  const [plateQuery, setPlateQuery] = useState('');

  const samples = useAsync((signal) => samplePlates({ mode, signal }, 5), [mode]);

  // Open on a plate that exists, so the view is never a dead end.
  useEffect(() => {
    if (!plateQuery && samples.data && samples.data.length > 0) {
      const first = String(samples.data[0]!.kenteken ?? '');
      if (first) {
        setPlateQuery(first);
        setInput(formatPlate(first));
      }
    }
  }, [samples.data, plateQuery]);

  const passport = useAsync(
    (signal) => (plateQuery ? loadPassport({ mode, signal }, plateQuery) : Promise.resolve(null)),
    [mode, plateQuery],
  );

  const data = passport.data;
  const vehicle = data?.vehicle;

  /* Defect codes over time - the inspection history as a shape, not a list. */
  const defectsByYear = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const defect of data.defects) {
      const year = defect.date?.slice(0, 4);
      if (year) counts.set(year, (counts.get(year) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, count]) => ({
      label: year,
      value: count,
    }));
  }, [data]);

  const co2 = useMemo(() => {
    const values = (data?.fuels ?? [])
      .map((f) => toNumber(f.co2_uitstoot_gecombineerd))
      .filter((v): v is number => v != null);
    return values.length > 0 ? Math.max(...values) : null;
  }, [data]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setPlateQuery(input.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  };

  return (
    <>
      <section className="section" style={{ marginTop: 4 }}>
        <div className="section__head">
          <p className="eyebrow">Voertuigpaspoort</p>
          <h2 className="section__title">Eén kenteken, zes datasets</h2>
          <p className="section__lede">
            Het register kent het voertuig, een tweede dataset de uitstoot, een derde de
            carrosserie, een vierde de assen, een vijfde elk gebrek dat een keurmeester ooit
            noteerde — en een zesde vertaalt die gebrekcodes naar leesbare zinnen. Losse datasets
            zeggen weinig; samen vormen ze een paspoort.
          </p>
        </div>

        <form className="filters" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Kenteken</span>
            <input
              type="search"
              value={input}
              placeholder="XX-999-X"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <button type="submit" className="chip" style={{ alignSelf: 'flex-end', height: 34 }}>
            Opzoeken
          </button>
          <div className="filters__spacer" />
          <div className="field">
            <span className="field__label">Voorbeelden uit het register</span>
            <div className="suggestions">
              {(samples.data ?? []).map((row) => {
                const kenteken = String(row.kenteken ?? '');
                return (
                  <button
                    key={kenteken}
                    type="button"
                    className="suggestion"
                    onClick={() => {
                      setPlateQuery(kenteken);
                      setInput(formatPlate(kenteken));
                    }}
                  >
                    {formatPlate(kenteken)}
                  </button>
                );
              })}
            </div>
          </div>
        </form>
      </section>

      {passport.loading ? (
        <div className="empty-state">
          <h3>Datasets bevragen…</h3>
          <p>Zes verzoeken lopen parallel.</p>
        </div>
      ) : passport.error ? (
        <div className="empty-state">
          <h3>Opzoeken mislukt</h3>
          <p>{passport.error.message}</p>
        </div>
      ) : !vehicle ? (
        <div className="empty-state">
          <h3>Geen voertuig gevonden op {formatPlate(plateQuery) || 'dit kenteken'}</h3>
          <p>
            Kentekens van geëxporteerde of gesloopte voertuigen verdwijnen uit het register. Probeer
            een van de voorbeelden hierboven.
          </p>
        </div>
      ) : (
        <div className="passport">
          <div className="passport__hero">
            <div className="passport__identity">
              <span className="plate">{formatPlate(String(vehicle.kenteken))}</span>
              <h2>
                {titleCase(value(vehicle, 'merk') ?? '')}{' '}
                {titleCase(value(vehicle, 'handelsbenaming') ?? '')}
              </h2>
              <p>
                {titleCase(value(vehicle, 'voertuigsoort') ?? '')} ·{' '}
                {titleCase(value(vehicle, 'inrichting') ?? '–')} ·{' '}
                {titleCase(value(vehicle, 'eerste_kleur') ?? '–')} · eerste toelating{' '}
                {shortDate(value(vehicle, 'datum_eerste_toelating_dt'))}
              </p>
            </div>
            <div className="passport__badges">
              <span className="badge">
                <span
                  className="badge__dot"
                  style={{ background: powertrainColour(data.powertrain) }}
                  aria-hidden="true"
                />
                {data.powertrain}
              </span>
              <span className="badge">
                {data.defects.length === 0
                  ? 'Geen gebreken geregistreerd'
                  : `${num(data.defects.length)} gebreken bij de APK`}
              </span>
              <span className="badge">APK tot {shortDate(value(vehicle, 'vervaldatum_apk_dt'))}</span>
            </div>
          </div>

          <ChartCard
            title="Uit het kentekenregister"
            subtitle="Gekentekende voertuigen — de spil waaraan de rest hangt"
            sources={['vehicles']}
            span="two-thirds"
          >
            <div className="spec-list">
              <Spec label="Merk">{titleCase(value(vehicle, 'merk') ?? '')}</Spec>
              <Spec label="Handelsbenaming">{titleCase(value(vehicle, 'handelsbenaming') ?? '')}</Spec>
              <Spec label="Ledig gewicht">
                {value(vehicle, 'massa_ledig_voertuig')
                  ? `${num(toNumber(vehicle.massa_ledig_voertuig))} kg`
                  : null}
              </Spec>
              <Spec label="Max. toegestane massa">
                {value(vehicle, 'toegestane_maximum_massa_voertuig')
                  ? `${num(toNumber(vehicle.toegestane_maximum_massa_voertuig))} kg`
                  : null}
              </Spec>
              <Spec label="Cilinderinhoud">
                {toNumber(vehicle.cilinderinhoud)
                  ? `${num(toNumber(vehicle.cilinderinhoud))} cm³`
                  : 'n.v.t.'}
              </Spec>
              <Spec label="Zitplaatsen">{value(vehicle, 'aantal_zitplaatsen')}</Spec>
              <Spec label="Catalogusprijs">{euro(toNumber(vehicle.catalogusprijs))}</Spec>
              <Spec label="Lengte × breedte">
                {value(vehicle, 'lengte') && value(vehicle, 'breedte')
                  ? `${num(toNumber(vehicle.lengte))} × ${num(toNumber(vehicle.breedte))} cm`
                  : null}
              </Spec>
              <Spec label="EU-voertuigcategorie">{value(vehicle, 'europese_voertuigcategorie')}</Spec>
              <Spec label="Laatste tenaamstelling">
                {shortDate(value(vehicle, 'datum_tenaamstelling_dt'))}
              </Spec>
            </div>
          </ChartCard>

          <ChartCard
            title="Status"
            subtitle="Signalen die het register zelf bijhoudt"
            sources={['vehicles']}
            span="third"
          >
            <div style={{ display: 'grid', gap: 12 }}>
              <Meter
                label="WAM-verzekering"
                fraction={value(vehicle, 'wam_verzekerd') === 'Ja' ? 1 : 0}
                valueText={value(vehicle, 'wam_verzekerd') === 'Ja' ? 'Verzekerd' : 'Niet verzekerd'}
                level={value(vehicle, 'wam_verzekerd') === 'Ja' ? 'good' : 'critical'}
                statusText={
                  value(vehicle, 'wam_verzekerd') === 'Ja'
                    ? 'Wettelijke aansprakelijkheid gedekt'
                    : 'Wettelijk verplichte dekking ontbreekt'
                }
              />
              <Meter
                label="Terugroepactie"
                fraction={value(vehicle, 'openstaande_terugroepactie_indicator') === 'Ja' ? 1 : 0}
                valueText={
                  value(vehicle, 'openstaande_terugroepactie_indicator') === 'Ja'
                    ? 'Openstaand'
                    : 'Geen'
                }
                level={
                  value(vehicle, 'openstaande_terugroepactie_indicator') === 'Ja' ? 'serious' : 'good'
                }
                statusText={
                  value(vehicle, 'openstaande_terugroepactie_indicator') === 'Ja'
                    ? 'De fabrikant heeft een actie uitstaan'
                    : 'Geen actie van de fabrikant open'
                }
              />
              <Meter
                label="Exportmelding"
                fraction={value(vehicle, 'export_indicator') === 'Ja' ? 1 : 0}
                valueText={value(vehicle, 'export_indicator') === 'Ja' ? 'Gemeld' : 'Nee'}
                level={value(vehicle, 'export_indicator') === 'Ja' ? 'warning' : 'good'}
                statusText={
                  value(vehicle, 'export_indicator') === 'Ja'
                    ? 'Staat geregistreerd voor export'
                    : 'Staat niet voor export geregistreerd'
                }
              />
            </div>
          </ChartCard>

          <ChartCard
            title="Brandstof en emissies"
            subtitle="Eén regel per brandstof — een plug-in hybride heeft er twee"
            sources={['fuel']}
            span="half"
            note={
              data.missing.includes('brandstof')
                ? 'De brandstofdataset antwoordde niet voor dit kenteken.'
                : undefined
            }
          >
            {data.fuels.length === 0 ? (
              <p className="chart-empty">Geen brandstofregels voor dit kenteken.</p>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {data.fuels.map((fuel, index) => (
                  <div key={index}>
                    <p style={{ fontWeight: 650, marginBottom: 6 }}>
                      {value(fuel, 'brandstof_omschrijving') ?? 'Onbekend'}{' '}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                        · regel {value(fuel, 'brandstof_volgnummer') ?? index + 1}
                      </span>
                    </p>
                    <div className="spec-list">
                      <Spec label="CO₂ gecombineerd">
                        {toNumber(fuel.co2_uitstoot_gecombineerd) != null
                          ? `${num(toNumber(fuel.co2_uitstoot_gecombineerd))} g/km`
                          : null}
                      </Spec>
                      <Spec label="Verbruik">
                        {toNumber(fuel.brandstofverbruik_gecombineerd) != null
                          ? `${num1(toNumber(fuel.brandstofverbruik_gecombineerd))} l/100 km`
                          : 'n.v.t.'}
                      </Spec>
                      <Spec label="Nettomaximumvermogen">
                        {toNumber(fuel.nettomaximumvermogen) != null
                          ? `${num(toNumber(fuel.nettomaximumvermogen))} kW`
                          : null}
                      </Spec>
                      <Spec label="Milieuklasse">
                        {value(fuel, 'milieuklasse_eg_goedkeuring_licht') ??
                          value(fuel, 'emissiecode_omschrijving')}
                      </Spec>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Carrosserie, assen en klasse"
            subtitle="Drie aparte datasets, samengevoegd op hetzelfde kenteken"
            sources={['body', 'axles', 'vehicleClass']}
            span="half"
          >
            <div className="spec-list">
              <Spec label="Carrosserie">
                {titleCase(value(data.body[0], 'type_carrosserie_europese_omschrijving') ?? '')}
              </Spec>
              <Spec label="Aantal assen">
                {value(data.axles[0], 'aantal_assen') ?? String(data.axles.length || '–')}
              </Spec>
              <Spec label="Aangedreven assen">
                {data.axles.filter((axle) => value(axle, 'aangedreven_as') === 'J').length || '–'}
              </Spec>
              <Spec label="Spoorbreedte">
                {toNumber(data.axles[0]?.spoorbreedte) != null
                  ? `${num(toNumber(data.axles[0]?.spoorbreedte))} cm`
                  : null}
              </Spec>
              <Spec label="Voertuigklasse">
                {value(data.vehicleClass[0], 'code_toevoeging_uitvoering') ??
                  value(vehicle, 'europese_voertuigcategorie')}
              </Spec>
              <Spec label="Wielbasis">
                {toNumber(vehicle.wielbasis) != null ? `${num(toNumber(vehicle.wielbasis))} cm` : null}
              </Spec>
            </div>
          </ChartCard>

          <ChartCard
            title="Gebreken per keuringsjaar"
            subtitle="Hoeveel gebreken keurmeesters per jaar noteerden"
            sources={['defectsFound']}
            span="third"
            table={{
              columns: ['Jaar', 'Gebreken'],
              rows: defectsByYear.map((d) => [d.label, d.value]),
            }}
          >
            {defectsByYear.length === 0 ? (
              <p className="chart-empty">Geen gebreken geregistreerd op dit kenteken.</p>
            ) : (
              <BarChart
                data={defectsByYear}
                formatValue={num}
                labelWidth={52}
                rowHeight={32}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Keuringshistorie"
            subtitle="Elke gebrekcode uit de APK, vertaald met de wettelijke gebrekenlijst"
            sources={['defectsFound', 'defectCodes']}
            span="two-thirds"
            note="Zonder de gebrekenlijst is de inspectiedataset een kolom met codes. De koppeling maakt er een leesbare historie van."
          >
            {data.defects.length === 0 ? (
              <p className="chart-empty">
                Op dit kenteken staan geen geconstateerde gebreken geregistreerd.
              </p>
            ) : (
              <div className="timeline">
                {data.defects.slice(0, 40).map((defect, index) => (
                  <div className="timeline__item" key={`${defect.code}-${index}`}>
                    <span className="timeline__date">{shortDate(defect.date)}</span>
                    <span className="timeline__code">{defect.code}</span>
                    <span className="timeline__text">{defect.description}</span>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          {co2 != null ? (
            <p className="notice" style={{ gridColumn: 'span 12', margin: 0 }}>
              <span className="notice__icon" aria-hidden="true">
                ●
              </span>
              <span>
                Dit voertuig stoot <strong>{num(co2)} g CO₂ per kilometer</strong> uit volgens de
                brandstofdataset — een getal dat nergens in het kentekenregister zelf staat.
              </span>
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
