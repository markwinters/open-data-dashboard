import { useEffect, useMemo, useState } from 'react';
import type { SourceMode } from '../lib/dataSource';
import { useAsync } from '../lib/useAsync';
import { loadPassport, isOpenRecall, samplePlates } from '../data/queries';
import { ChartCard } from '../charts/ChartCard';
import { BarChart } from '../charts/BarChart';
import { Telltale, TelltalePanel } from '../charts/Instruments';
import { euro, num, num1, plate as formatPlate, shortDate, titleCase, toNumber } from '../lib/format';
import { readOdometerVerdict } from '../data/odometerVerdict';
import { powertrainColour } from '../lib/palette';
import { fetchKooijmans, kooijmansPhotoUrl, EXTERNAL_SOURCES, type KooijmansVehicle } from '../lib/externalApi';
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

/* ---------------------------------------------------------------- sharing */

/** A passport is only shareable when the link carries the plate, which it does
    through the `#paspoort/<plaat>` hash. */
const shareUrl = (plate: string): string =>
  `${window.location.origin}${window.location.pathname}#paspoort/${plate}`;

interface ShareTarget {
  label: string;
  href: (text: string, url: string) => string;
  icon: React.ReactNode;
}

const ICON_SIZE = 16;

const SOCIALS: ShareTarget[] = [
  {
    label: 'Delen op X',
    href: (text, url) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.9 2.5h3.3l-7.3 8.4 8.6 11.4h-6.7l-5.3-6.9-6 6.9H1.5l7.8-9L1.1 2.5h6.9l4.8 6.3 5.5-6.3h.6z" />
      </svg>
    ),
  },
  {
    label: 'Delen op Facebook',
    href: (_text, url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.5 21.5v-7h2.4l.4-3h-2.8V9.6c0-.9.3-1.5 1.6-1.5h1.3V5.4c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v2.4H8.4v3h2.9v7h2.2z" />
      </svg>
    ),
  },
  {
    label: 'Delen op WhatsApp',
    href: (text, url) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.2-1.5-.8-1.7-.9-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.8-.3-1.5-.8-2-1.5-.1-.2 0-.4.1-.5l.6-.7c.1-.3 0-.4 0-.6l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3l-1.1 1.1c-.3.3-.4.7-.2 1.1 1 2 2.4 3.8 4.7 4.9.7.3 1.3.5 1.7.6.4.1 1.2.4 1.4.2.2-.1.9-.9 1-1.2.1-.3.1-.5-.1-.7z" />
      </svg>
    ),
  },
  {
    label: 'Delen op LinkedIn',
    href: (_text, url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6.9 8.5H3.6V21h3.3V8.5zM5.2 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 13.9c0-3.2-1.7-4.7-4-4.7-1.8 0-2.7 1-3.2 1.7V8.5h-3.3V21H14v-6.4c0-1.5.7-2.3 1.9-2.3s1.8.9 1.8 2.2V21H21v-7.1z" />
      </svg>
    ),
  },
  {
    label: 'Delen per e-mail',
    href: (text, url) =>
      `mailto:?subject=${encodeURIComponent('RDW Open Data · voertuigpaspoort')}&body=${encodeURIComponent(`${text}\n${url}`)}`,
    icon: (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm8 6.6L5.4 7h13.2L12 11.6zM5 17h14V8.9L12 13.4 5 8.9V17z" />
      </svg>
    ),
  },
];

/** The share toolbar the passport hero carries: native share when the browser
    has it, direct links to the common channels, and a copyable link. */
function ShareRow({ plate, title }: { plate: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const url = shareUrl(plate);
  const text = `RDW Open Data: ${title} (${formatPlate(plate)})`;
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function';

  const nativeShare = async () => {
    try {
      await navigator.share({ title: text.split(' (')[0] ?? text, text, url });
    } catch (error) {
      // A dismissed share sheet is not an error worth showing.
      if ((error as { name?: string })?.name === 'AbortError') return;
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link stays visible in the address bar.
    }
  };

  return (
    <div className="passport__share" role="group" aria-label="Dit paspoort delen">
      {canShare ? (
        <button
          type="button"
          className="share share--native"
          onClick={() => void nativeShare()}
          title="Delen via het systeemmenu"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3m0 0L8 7m4-4 4 4" />
            <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          </svg>
          Delen
        </button>
      ) : null}
      {SOCIALS.map((social) => (
        <a
          key={social.label}
          className="icon-button"
          href={social.href(text, url)}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={social.label}
          title={social.label}
        >
          {social.icon}
        </a>
      ))}
      <button
        type="button"
        className="icon-button"
        onClick={() => void copyLink()}
        aria-label={copied ? 'Link gekopieerd' : 'Kopieer link'}
        title={copied ? 'Link gekopieerd' : 'Kopieer link'}
      >
        {copied ? <span className="share__check">✓</span> : (
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 1 0-5.7-5.7L12 6" />
            <path d="M14 10a4 4 0 0 0-5.7 0L4.7 13.6a4 4 0 1 0 5.7 5.7L12 18" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function PassportView({
  mode,
  initialPlate,
}: {
  mode: SourceMode;
  initialPlate?: string;
}) {
  const [input, setInput] = useState('');
  const [plateQuery, setPlateQuery] = useState('');

  /* A shared link may land here loaded with the plate (`#paspoort/<plaat>`).
     Only apply it when it is new, so retyping a plate overwrites it. */
  useEffect(() => {
    if (!initialPlate) return;
    const raw = initialPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw && raw !== plateQuery) {
      setPlateQuery(raw);
      setInput(formatPlate(raw));
    }
  }, [initialPlate, plateQuery]);

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

  /* Kooijmans: vehicle photos and brand logos from an external API. */
  const [kooijmans, setKooijmans] = useState<KooijmansVehicle | null>(null);
  useEffect(() => {
    if (!plateQuery) { setKooijmans(null); return; }
    const controller = new AbortController();
    fetchKooijmans(plateQuery, controller.signal).then(setKooijmans);
    return () => controller.abort();
  }, [plateQuery]);

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

  /* The APK lamp is the one telltale with a threshold: expired burns red, and
     the last two months before expiry burn amber, like a service reminder. */
  const apk = useMemo(() => {
    const raw = vehicle ? value(vehicle, 'vervaldatum_apk_dt') : null;
    if (!raw) {
      return { lit: false, level: 'warning' as const, detail: 'Geen vervaldatum geregistreerd' };
    }
    const expiry = new Date(raw.slice(0, 10));
    const days = Math.round((expiry.getTime() - Date.now()) / 86_400_000);
    if (days < 0) {
      return { lit: true, level: 'critical' as const, detail: `Verlopen op ${shortDate(raw)}` };
    }
    if (days <= 60) {
      return { lit: true, level: 'warning' as const, detail: `Verloopt over ${days} dagen` };
    }
    return { lit: false, level: 'good' as const, detail: `Geldig tot ${shortDate(raw)}` };
  }, [vehicle]);

  /* Three register columns read as one verdict on the odometer history, with
     RDW's explanation table (`jqs4-4kvw`) resolving the reason code. */
  const odometer = useMemo(
    () =>
      readOdometerVerdict(
        vehicle ? value(vehicle, 'tellerstandoordeel') : null,
        vehicle ? value(vehicle, 'jaar_laatste_registratie_tellerstand') : null,
        vehicle ? value(vehicle, 'code_toelichting_tellerstandoordeel') : null,
        data?.odometerReasons ?? null,
      ),
    [vehicle, data?.odometerReasons],
  );

  /* A recall lamp: the register's own indicator is the primary source, and an
     open row in the detail table as a guard - a plate whose recallStatus still
     lists an open action must be lit even if the register flag has drifted. */
  const recallIndicator = useMemo(() => {
    const openInDetail = (data?.recalls ?? []).some((recall) => isOpenRecall(recall));
    const flag = value(vehicle, 'openstaande_terugroepactie_indicator') === 'Ja';
    if (openInDetail || flag) {
      const openCount = (data?.recalls ?? []).filter((r) => isOpenRecall(r)).length;
      return { lit: true, count: openCount || null };
    }
    return { lit: false, count: null };
  }, [data?.recalls, vehicle]);

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
          <h2 className="section__title">Eén kenteken, veertien RDW-datasets</h2>
          <p className="section__lede">
            Het register kent het voertuig, een tweede dataset de uitstoot, een derde de carrosserie,
            een vierde de assen, een vijfde de voertuigklasse en de EU-subcategorie, een zesde elke
            APK-gebrek die een keurmeester ooit noteerde, een zevende de actieve terugroepacties — en
            een lexicon vertaalt de codes naar leesbare zinnen. Losse datasets zeggen weinig; samen
            vormen ze een paspoort.
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
              <ShareRow
                plate={String(vehicle.kenteken)}
                title={`${titleCase(value(vehicle, 'merk') ?? '')} ${titleCase(value(vehicle, 'handelsbenaming') ?? '')}`.trim()}
              />
            </div>
            {kooijmans?.PhotoFront ? (
              <figure className="passport__photo">
                <img
                  src={kooijmansPhotoUrl(kooijmans.PathPhoto ?? '', kooijmans.PhotoFront)}
                  alt={`${titleCase(kooijmans.Make)} ${kooijmans.Model} — foto voorzijde`}
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
                {kooijmans.Make ? (
                  <figcaption>
                    {kooijmans.Make} {kooijmans.Model}
                    {kooijmans.RdwEnergyLabel ? ` · energielabel ${kooijmans.RdwEnergyLabel}` : ''} ·{' '}
                    <a
                      href={EXTERNAL_SOURCES.kooijmans.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="spec__muted"
                    >
                      foto via Kooijmans
                    </a>
                  </figcaption>
                ) : null}
              </figure>
            ) : null}
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
            title="Waarschuwingslampjes"
            subtitle="De signalen die het register zelf bijhoudt, als lampjes op het dashboard"
            sources={['vehicles']}
            span="full"
            note="Een brandend lampje betekent hier hetzelfde als in de auto: er staat iets open."
          >
            <TelltalePanel>
              <Telltale
                kind="insurance"
                label="WAM-verzekering"
                lit={value(vehicle, 'wam_verzekerd') !== 'Ja'}
                level="critical"
                detail={
                  value(vehicle, 'wam_verzekerd') === 'Ja'
                    ? 'Wettelijke aansprakelijkheid gedekt'
                    : 'Wettelijk verplichte dekking ontbreekt'
                }
              />
              <Telltale
                kind="recall"
                label="Terugroepactie"
                lit={recallIndicator.lit}
                level="serious"
                detail={
                  recallIndicator.lit
                    ? recallIndicator.count
                      ? `${recallIndicator.count} openstaande ${recallIndicator.count === 1 ? 'actie' : 'acties'} op dit kenteken`
                      : 'De fabrikant heeft een actie uitstaan'
                    : 'Geen openstaande actie van de fabrikant'
                }
              />
              <Telltale
                kind="inspection"
                label="APK"
                lit={apk.lit}
                level={apk.level}
                detail={apk.detail}
              />
              <Telltale
                kind="odometer"
                label="Tellerstand"
                lit={odometer.lit}
                level={odometer.level}
                detail={odometer.verdict ? `Oordeel: ${odometer.verdict}` : 'Nog geen oordeel over de reeks'}
              />
              <Telltale
                kind="export"
                label="Exportmelding"
                lit={value(vehicle, 'export_indicator') === 'Ja'}
                level="warning"
                detail={
                  value(vehicle, 'export_indicator') === 'Ja'
                    ? 'Staat geregistreerd voor export'
                    : 'Staat niet voor export geregistreerd'
                }
              />
              <Telltale
                kind="taxi"
                label="Taxi-indicatie"
                lit={value(vehicle, 'taxi_indicator') === 'Ja'}
                level="good"
                detail={
                  value(vehicle, 'taxi_indicator') === 'Ja'
                    ? 'Geregistreerd voor taxivervoer'
                    : 'Niet als taxi geregistreerd'
                }
              />
            </TelltalePanel>
          </ChartCard>

          <ChartCard
            title="Uit het kentekenregister"
            subtitle="Gekentekende voertuigen — de spil waaraan de rest hangt"
            sources={[
              'vehicles',
              ...(kooijmans?.CurrentValue ? [EXTERNAL_SOURCES.kooijmans] : []),
            ]}
            span="half"
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
              {kooijmans?.CurrentValue ? (
                <Spec label="Huidige waarde">
                  {euro(kooijmans.CurrentValue)} <span className="spec__muted">· via Kooijmans</span>
                </Spec>
              ) : null}
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
            title="Terugroepacties"
            subtitle="Van kenteken naar referentiecode, met de status van elke actie"
            sources={['recallStatus', 'recallAction', 'recallRisk']}
            span="half"
            note="Alleen een actie met status 'Openstaande terugroepactie' telt voor het lampje. 'Herstel gemeld' betekent dat de producent het herstel heeft gemeld — dan brandt het lampje terecht niet."
          >
            {data.recalls.length === 0 ? (
              <p className="chart-empty">
                Geen terugroepacties geregistreerd op dit kenteken.
              </p>
            ) : (
              <div className="recall-list">
                {data.recalls.map((recall) => {
                  const open = isOpenRecall(recall);
                  return (
                    <article
                      className={`recall${open ? ' recall--open' : ''}`}
                      key={recall.reference}
                    >
                      <header>
                        <span className="recall__code">{recall.reference}</span>
                        <span className="recall__date">{shortDate(recall.published)}</span>
                      </header>
                      <p className="recall__status">
                        <span className="recall__statusdot" aria-hidden="true" />
                        {recall.status ?? (open ? 'Openstaande terugroepactie' : 'Status onbekend')}
                      </p>
                      <p className="recall__risk">
                        {recall.risk ?? 'Geen risico-omschrijving in het register.'}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Tellerstand"
            subtitle="Het oordeel van de RDW over de reeks kilometerstanden"
            sources={['vehicles']}
            span="half"
            note="De RDW publiceert geen kilometerstand, alleen een oordeel over de reeks standen."
          >
            <div className="spec-list">
              <Spec label="Oordeel">{odometer.verdict ?? 'Geen oordeel'}</Spec>
              <Spec label="Laatste registratie">
                {odometer.year == null ? '–' : String(odometer.year)}
              </Spec>
            </div>
            {odometer.reason ? <p className="card__note">{odometer.reason}</p> : null}
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
              <Spec label="Plaatscode assen">
                {data.axles
                  .map((axle) => `as ${value(axle, 'as_nummer')}: ${value(axle, 'plaatscode_as')}`)
                  .join(' · ') || '–'}
              </Spec>
              <Spec label="Voertuigklasse">
                {value(data.vehicleClass[0], 'voertuigklasse_omschrijving') ??
                  value(data.vehicleClass[0], 'voertuigklasse') ??
                  value(vehicle, 'europese_voertuigcategorie')}
              </Spec>
              <Spec label="Wielbasis">
                {toNumber(vehicle.wielbasis) != null ? `${num(toNumber(vehicle.wielbasis))} cm` : null}
              </Spec>
            </div>
          </ChartCard>

          <ChartCard
            title="Subcategorie en bijzonderheden"
            subtitle="De EU-subcategorie, wettelijke bijzonderheden en rupsbandsets"
            sources={['subcategory', 'specialFeatures', 'trackSets']}
            span="half"
          >
            <div className="spec-list">
              <Spec label="Subcategorie">
                {value(
                  data.subcategory[0],
                  'subcategorie_voertuig_europees_omschrijving',
                ) ??
                  value(data.subcategory[0], 'subcategorie_voertuig_europees') ??
                  'Verenigbaar met de voertuigklasse'}
              </Spec>
              <Spec label="Bijzonderheden">
                {data.specialFeatures
                  .map(
                    (feature) =>
                      `${value(feature, 'bijzonderheid_code') ?? '?'}${
                        value(feature, 'bijzonderheid_code_1') ? ` (${value(feature, 'bijzonderheid_code_1')})` : ''
                      }`,
                  )
                  .join(' · ') || 'Geen bijzonderheden geregistreerd'}
              </Spec>
              <Spec label="Rupsbandsets">
                {data.trackSets.length === 0
                  ? 'Geen rupsbandset geregistreerd'
                  : data.trackSets
                      .map((track) => {
                        const driven = value(track, 'aangedreven_rupsband_indicator') === 'J' ? 'aangedreven' : 'ongeremd';
                        const braked = value(track, 'geremde_rupsband_indicator') === 'J' ? 'geremd' : '';
                        return `set ${value(track, 'rupsband_set_volgnr')}: ${[braked, driven].filter(Boolean).join(', ')}`;
                      })
                      .join(' · ')}
              </Spec>
            </div>
          </ChartCard>

          <ChartCard
            title="Gebreken per keuringsjaar"
            subtitle="Hoeveel gebreken keurmeesters per jaar noteerden"
            sources={['defectsFound']}
            span="half"
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
            span="full"
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
