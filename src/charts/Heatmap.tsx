import { useMemo } from 'react';
import { SEQUENTIAL_STEPS, sequential } from '../lib/palette';
import { useMeasure } from './core';
import { ChartTooltip, useTooltip } from './Tooltip';

/** Composite map key. A row or column name may itself contain punctuation, so
 *  the two parts are encoded rather than concatenated with a separator. */
const cellKey = (row: string, column: string): string => JSON.stringify([row, column]);

export interface HeatCell {
  row: string;
  column: string;
  value: number | null;
}

interface HeatmapProps {
  rows: string[];
  columns: string[];
  cells: HeatCell[];
  formatValue?: (value: number) => string;
  /** Exact value for the hover readout; defaults to `formatValue`. */
  formatExact?: (value: number) => string;
  /** What the colour means, for the scale legend. */
  scaleLabel: string;
  rowLabel?: string;
  columnLabel?: string;
  cellHeight?: number;
  labelWidth?: number;
}

/**
 * A grid of magnitudes on one sequential hue: more is further from the surface
 * (darker on the light theme, lighter on the dark one). Used where the question
 * is "which combination stands out", which a row of bar charts cannot answer at
 * a glance.
 */
export function Heatmap({
  rows,
  columns,
  cells,
  formatValue = (v) => v.toLocaleString('nl-NL'),
  formatExact,
  scaleLabel,
  rowLabel = '',
  columnLabel = '',
  cellHeight = 30,
  labelWidth = 132,
}: HeatmapProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const exact = formatExact ?? formatValue;

  const { lookup, max } = useMemo(() => {
    const map = new Map<string, number>();
    let highest = 0;
    for (const cell of cells) {
      if (cell.value == null) continue;
      map.set(cellKey(cell.row, cell.column), cell.value);
      if (cell.value > highest) highest = cell.value;
    }
    return { lookup: map, max: highest };
  }, [cells]);

  const headerHeight = 26;
  const height = rows.length * cellHeight + headerHeight + 4;

  if (width === 0) return <div ref={ref} style={{ height }} />;

  // Below this, column headers start colliding. Rather than let them overlap,
  // the grid keeps its width and scrolls inside its own container.
  const MIN_CELL = 76;
  const naturalWidth = Math.max(width, labelWidth + 8 + columns.length * MIN_CELL);
  const gridWidth = Math.max(40, naturalWidth - labelWidth - 8);
  const cellWidth = gridWidth / Math.max(1, columns.length);

  // Row labels are trimmed to their gutter rather than clipped by the edge of
  // the chart; the full name stays in the tooltip and the table view.
  const CHAR_WIDTH = 6.1;
  const fitLabel = (label: string) => {
    const max = Math.floor(labelWidth / CHAR_WIDTH);
    return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`;
  };

  return (
    <div ref={ref} className="chart" style={{ position: 'relative' }}>
      <div className="chart__scroller">
        <svg width={naturalWidth} height={height} role="img">
          {columns.map((column, ci) => (
            <text
              key={column}
              x={labelWidth + 8 + ci * cellWidth + cellWidth / 2}
              y={16}
              className="axis-text axis-text--mid"
            >
              {column}
            </text>
          ))}

          {rows.map((row, ri) => (
            <g key={row}>
              <text
                x={labelWidth}
                y={headerHeight + ri * cellHeight + cellHeight / 2 + 4}
                className="axis-text axis-text--end"
              >
                {fitLabel(row)}
              </text>
              {columns.map((column, ci) => {
                const value = lookup.get(cellKey(row, column)) ?? null;
                const t = value == null || max === 0 ? 0 : value / max;
                const text = value == null ? null : formatValue(value);
                // Only label a cell that can hold the text with padding on both
                // sides; otherwise the tooltip and the table view carry the value.
                const labelFits = text != null && cellWidth - 12 > text.length * 6.6;
                return (
                  <g
                    key={column}
                    onPointerEnter={() =>
                      show({
                        x: labelWidth + 8 + ci * cellWidth + cellWidth / 2,
                        y: headerHeight + ri * cellHeight,
                        title: `${row}${columnLabel ? ` · ${columnLabel} ` : ' · '}${column}`,
                        rows: [
                          {
                            label: scaleLabel,
                            value: value == null ? 'geen gegevens' : exact(value),
                            colour: value == null ? undefined : sequential(t),
                          },
                          ...(rowLabel ? [{ label: rowLabel, value: row }] : []),
                        ],
                      })
                    }
                    onPointerLeave={hide}
                  >
                    <rect
                      // The 2px gap between cells is the surface showing through.
                      x={labelWidth + 8 + ci * cellWidth + 1}
                      y={headerHeight + ri * cellHeight + 1}
                      width={Math.max(0, cellWidth - 2)}
                      height={cellHeight - 2}
                      rx={3}
                      fill={value == null ? 'var(--surface-sunken)' : sequential(t)}
                    />
                    {labelFits ? (
                      <text
                        x={labelWidth + 8 + ci * cellWidth + cellWidth / 2}
                        y={headerHeight + ri * cellHeight + cellHeight / 2 + 4}
                        className="axis-text axis-text--mid heat-value"
                        // Ink picked by how saturated the fill is, so the label
                        // always clears contrast against its own cell.
                        style={{ fill: t > 0.55 ? 'var(--heat-ink-high)' : 'var(--heat-ink-low)' }}
                      >
                        {text}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      <div className="scale-legend">
        <span>{scaleLabel}</span>
        <span className="scale-legend__ends">0</span>
        <span className="scale-legend__ramp" aria-hidden="true">
          {SEQUENTIAL_STEPS.filter((_, i) => i % 2 === 0).map((step) => (
            <i key={step} style={{ background: step }} />
          ))}
        </span>
        <span className="scale-legend__ends">{formatValue(max)}</span>
      </div>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
