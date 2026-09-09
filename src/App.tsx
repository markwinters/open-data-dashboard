import { useCallback, useEffect, useState } from 'react';
import { clearCache, demoFleetSize, probeLive, type SourceMode } from './lib/dataSource';
import { DATASETS, datasetPage, type DatasetKey } from './data/datasets';
import { OverviewView } from './views/OverviewView';
import { CohortView } from './views/CohortView';
import { PassportView } from './views/PassportView';
import { num } from './lib/format';

type Tab = 'overzicht' | 'analyse' | 'paspoort';
type Theme = 'system' | 'light' | 'dark';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overzicht', label: 'Overzicht' },
  { id: 'analyse', label: 'Verbonden analyse' },
  { id: 'paspoort', label: 'Voertuigpaspoort' },
];

const THEME_KEY = 'rdw-dashboard-theme';

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
        ) : (
          <PassportView mode={mode} />
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
