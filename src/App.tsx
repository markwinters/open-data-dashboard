import { useCallback, useEffect, useState } from 'react';
import { clearCache, demoFleetSize, probeLive, type SourceMode } from './lib/dataSource';
import { DATASETS, datasetPage, type DatasetKey } from './data/datasets';
import { OverviewView } from './views/OverviewView';
import { CohortView } from './views/CohortView';
import { PassportView } from './views/PassportView';
import { ParkingView } from './views/ParkingView';
import { num } from './lib/format';

type Tab = 'overzicht' | 'analyse' | 'paspoort' | 'parkeren';
type Theme = 'system' | 'light' | 'dark';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overzicht', label: 'Overzicht' },
  { id: 'analyse', label: 'Verbonden analyse' },
  { id: 'paspoort', label: 'Voertuigpaspoort' },
  { id: 'parkeren', label: 'Parkeren' },
];

const THEME_KEY = 'rdw-dashboard-theme';

/** Gratis verdieping die particulieren zelf kunnen raadplegen, buiten dit
    dashboard om. De koppeling blijft op de exacte pagina, zodat de bezoeker
    alleen het kenteken hoeft in te voeren. */
const CITIZEN_LINKS: { label: string; url: string; note: string }[] = [
  {
    label: 'RDW-kentekencheck',
    url: 'https://ovi.rdw.nl/',
    note: 'alle openbare gegevens van een kenteken: APK-datum, tellerstandoordeel, aantal eigenaren en openstaande terugroepacties',
  },
  {
    label: 'RDW-Voertuigrapport',
    url: 'https://tellerrapportuitgebreidaanvragen.rdw.nl/particulier',
    note: 'gratis voor eigenaar of houder met DigiD: kilometerstand-overzicht, APK-geschiedenis, aantal eigenaren en catalogusprijs',
  },
  {
    label: 'RDW · kilometerstand controleren',
    url: 'https://tellerstandcontroleren.rdw.nl/',
    note: 'oordeel over een precieze tellerstand van een personen- of lichte bedrijfsauto',
  },
  {
    label: 'RDW · terugroepregister',
    url: 'https://terugroepregister.rdw.nl/Pages/Terugroepregister.aspx',
    note: 'alle terugroepacties zoeken op merk, type en periode, sinds 2012',
  },
  {
    label: 'Mijn RDW',
    url: 'https://mijn.rdw.nl/',
    note: 'met DigiD: je voertuigen op naam, verzekering, schorsing, diefstalmelding en eigen terugroepacties',
  },
  {
    label: 'RDW · voertuigen tot 9 jaar terug',
    url: 'https://voertuigenopnaamtot9jaarterug.rdw.nl/',
    note: 'gratis digitaal overzicht van alle voertuigen die de afgelopen 9 jaar op je naam stonden',
  },
  {
    label: 'Meldpunt ILT',
    url: 'https://e-loket.ilent.nl/formulier/nl-NL/DefaultEnvironment/MOv_002.aspx/CB_Authenticatie/CB_Inleiding',
    note: 'veiligheids- of milieugebrek van een type melden bij de Inspectie Leefomgeving en Transport',
  },
  {
    label: 'AutoWeek kentekencheck',
    url: 'https://www.autoweek.nl/kentekencheck',
    note: 'gratis: bouwjaar, vermogen, aantal eigenaren, verbruik, emissieklasse en afmetingen',
  },
  {
    label: 'Kentekenfeiten.nl',
    url: 'https://kentekenfeiten.nl/',
    note: 'gratis check plus PDF: terugroepacties, WAM, APK-keuringshistorie, tellerstandoordeel en wegenbelasting',
  },
  {
    label: 'Schades.nl kentekencheck',
    url: 'https://www.schades.nl/',
    note: 'gratis kijkje in schademeldingen die op een kenteken geregistreerd staan',
  },
];

const THEME_LABEL: Record<Theme, string> = {
  system: 'Thema: systeem',
  light: 'Thema: licht',
  dark: 'Thema: donker',
};

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // Private windows and blocked site data both throw here; the system
      // preference is a perfectly good answer.
    }
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Non-fatal: the choice simply does not survive a reload.
    }
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((current) => (current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'));
  }, []);

  return [theme, cycle];
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overzicht');
  const [mode, setMode] = useState<SourceMode>('live');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [theme, cycleTheme] = useTheme();
  const [initialPlate, setInitialPlate] = useState<string | null>(null);

  /**
   * A shared passport link carries the plate in the hash (`#paspoort/<plaat>`),
   * so opening it elsewhere lands straight on that vehicle's passport instead
   * of the overview. No router to fight: the tabs are state, and the hash is
   * only read once on load.
   */
  useEffect(() => {
    const match = window.location.hash.match(/#paspoort\/([A-Z0-9\-.]+)/i);
    if (match?.[1]) {
      setInitialPlate(match[1]);
      setTab('paspoort');
    }
  }, []);

  /**
   * The dashboard opens against the live API and falls back to demo data if RDW
   * cannot be reached - a blocked network, an outage, or a resource that has
   * been renamed. Falling back keeps every panel populated instead of showing
   * an empty page, and the banner says which one is on screen.
   */
  useEffect(() => {
    let live = true;
    probeLive().then((result) => {
      if (!live) return;
      if (result.ok) setFallbackReason(null);
      else {
        setMode('demo');
        setFallbackReason(result.reason);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const switchMode = (next: SourceMode) => {
    clearCache();
    setMode(next);
  };

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__inner">
          <div className="brand">
            <span className="brand__mark">RDW Open Data</span>
            <span className="brand__sub">Nederlandse voertuigregistratie, verbonden</span>
          </div>

          <div className="tabs" role="tablist" aria-label="Weergaven">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className="tabs__tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="masthead__tools">
            <button
              type="button"
              className={`chip${mode === 'demo' ? ' chip--demo' : ''}`}
              onClick={() => switchMode(mode === 'live' ? 'demo' : 'live')}
              title={
                mode === 'live'
                  ? 'Live gegevens van opendata.rdw.nl — klik voor demogegevens'
                  : 'Gegenereerde demogegevens — klik om de live API te proberen'
              }
            >
              <span className="chip__dot" aria-hidden="true" />
              {mode === 'live' ? 'Live RDW' : 'Demogegevens'}
            </button>
            <button
              type="button"
              className="chip"
              onClick={cycleTheme}
              aria-label={`${THEME_LABEL[theme]}. Klik om te wisselen.`}
            >
              {THEME_LABEL[theme]}
            </button>
          </div>
        </div>
      </header>

      {mode === 'demo' ? (
        <p className="notice">
          <span className="notice__icon" aria-hidden="true">
            ●
          </span>
          <span>
            <strong>Demogegevens.</strong>{' '}
            {fallbackReason
              ? `${fallbackReason} `
              : 'Je kijkt naar gegenereerde voertuigen in plaats van de live API. '}
            De cijfers hieronder komen uit een gegenereerde vloot van {num(demoFleetSize())}{' '}
            voertuigen met dezelfde kolommen en codelijsten als RDW — realistisch van vorm, maar
            geen echte registratie. Zet de schakelaar rechtsboven op “Live RDW” om het opnieuw te
            proberen.
          </span>
        </p>
      ) : null}

      <main className="page">
        {tab === 'overzicht' ? (
          <OverviewView mode={mode} />
        ) : tab === 'analyse' ? (
          <CohortView mode={mode} />
        ) : tab === 'parkeren' ? (
          <ParkingView />
        ) : (
          <PassportView mode={mode} initialPlate={initialPlate ?? undefined} />
        )}
      </main>

      <footer className="colophon">
        <div className="colophon__inner">
          <div>
            <h4>Bronnen</h4>
            <ul>
              {(Object.keys(DATASETS) as DatasetKey[]).map((key) => (
                <li key={key}>
                  <a href={datasetPage(key)} target="_blank" rel="noreferrer noopener">
                    {DATASETS[key].name}
                  </a>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>{DATASETS[key].id}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Voor particulieren</h4>
            <p style={{ maxWidth: '40ch' }}>
              Meer over uw eigen of een tweedehands voertuig vindt u gratis bij de bron of bij
              een van deze aanbieders — rechtstreeks op de pagina, zonder zoeken.
            </p>
            <ul>
              {CITIZEN_LINKS.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer noopener">
                    {link.label}
                  </a>
                  <span style={{ color: 'var(--text-muted)' }}> — {link.note}</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ maxWidth: '46ch' }}>
            <h4>Over deze cijfers</h4>
            <p>
              Alle gegevens komen van{' '}
              <a href="https://opendata.rdw.nl" target="_blank" rel="noreferrer noopener">
                opendata.rdw.nl
              </a>
              , het open-dataplatform van de Rijksdienst voor het Wegverkeer. Aggregaties worden als
              SoQL-query bij de bron uitgerekend; koppelingen tussen datasets gebeuren in de browser,
              omdat het platform geen joins kent. Waar een tabblad met een steekproef rekent, staat
              dat erbij.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
