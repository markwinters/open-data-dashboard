import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { DATASETS, datasetPage, type DatasetKey } from '../data/datasets';

export interface LegendItem {
  label: string;
  colour: string;
  /** Bars and areas key with a swatch; lines key with a stroke. */
  shape?: 'rect' | 'line';
}

export interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Which RDW datasets the panel read, shown as provenance. */
  sources: DatasetKey[];
  legend?: LegendItem[];
  /** Every chart has a table-view twin; omit only for a bare stat tile. */
  table?: TableSpec;
  children: ReactNode;
  /** Dim, never unmount, while the next result loads. */
  refreshing?: boolean;
  loading?: boolean;
  error?: Error | null;
  span?: 'full' | 'half' | 'third' | 'two-thirds';
  /** A note under the chart - what the reader should take from it. */
  note?: string;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend" role="list">
      {items.map((item) => (
        <li key={item.label} className="legend__item">
          <span
            className={item.shape === 'line' ? 'legend__line' : 'legend__swatch'}
            style={{ background: item.colour }}
            aria-hidden="true"
          />
          <span className="legend__label">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function TableView({ spec }: { spec: TableSpec }) {
  return (
    <div className="table-view">
      <table>
        <thead>
          <tr>
            {spec.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                  {typeof cell === 'number' ? cell.toLocaleString('nl-NL') : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  sources,
  legend,
  table,
  children,
  refreshing = false,
  loading = false,
  error = null,
  span = 'half',
  note,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  const bodyId = useId();

  return (
    <section className={`card card--${span}`} aria-busy={loading || refreshing}>
      <header className="card__head">
        <div className="card__titles">
          <h3 className="card__title">{title}</h3>
          {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
        </div>
        {table ? (
          <button
            type="button"
            className="ghost-button"
            aria-expanded={showTable}
            aria-controls={bodyId}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Grafiek' : 'Tabel'}
          </button>
        ) : null}
      </header>

      {legend && legend.length > 0 ? <Legend items={legend} /> : null}

      <div id={bodyId} className={`card__body${refreshing ? ' card__body--stale' : ''}`}>
        {error ? (
          <p className="card__error" role="status">
            <strong>{error.message}</strong>
            {'hint' in error && typeof (error as { hint?: string }).hint === 'string' ? (
              <span>{(error as { hint?: string }).hint}</span>
            ) : null}
          </p>
        ) : loading ? (
          <p className="card__loading" role="status">
            Gegevens ophalen…
          </p>
        ) : showTable && table ? (
          <TableView spec={table} />
        ) : (
          children
        )}
      </div>

      {note ? <p className="card__note">{note}</p> : null}

      <footer className="card__source">
        <span>Bron</span>
        {sources.map((key) => (
          <a key={key} href={datasetPage(key)} target="_blank" rel="noreferrer noopener">
            {DATASETS[key].name}
          </a>
        ))}
      </footer>
    </section>
  );
}
