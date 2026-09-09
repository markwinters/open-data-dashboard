import { useMemo, useState } from 'react';
import { CHART_RADIUS, MAX_BAR_THICKNESS, SURFACE_GAP, band, barPath, linear, niceTicks, useMeasure } from './core';
import { ChartTooltip, useTooltip } from './Tooltip';

export interface StackSeries {
  key: string;
  label: string;
  colour: string;
}

export interface StackColumn {
  label: string;
  /** Value per series key. Missing keys count as zero. */
  values: Record<string, number>;
}

interface StackedColumnChartProps {
  columns: StackColumn[];
  series: StackSeries[];
  height?: number;
  /** Render each column as a share of its own total. */
  normalise?: boolean;
  formatValue?: (value: number) => string;
}

const MARGIN = { top: 16, right: 8, bottom: 30, left: 46 };

/**
 * Stacked columns for part-to-whole over time. Segments are separated by a 2px
 * gap in the surface colour rather than a stroke: white does the separating, so
 * no non-data ink is added to the mark.
 */
export function StackedColumnChart({
  columns,
  series,
  height = 280,
  normalise = false,
  formatValue = (v) => v.toLocaleString('nl-NL'),
}: StackedColumnChartProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const [hover, setHover] = useState<string | null>(null);

  const model = useMemo(() => {
    const totals = columns.map((c) => series.reduce((sum, s) => sum + (c.values[s.key] ?? 0), 0));
    const max = normalise ? 1 : Math.max(1, ...totals);
    const yTicks = normalise ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(0, max, 4);
    const top = Math.max(max, yTicks[yTicks.length - 1] ?? max);
    const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    return {
      totals,
      yTicks,
      x: band(columns.length, [MARGIN.left, MARGIN.left + plotWidth], 0.3),
      y: linear([0, top], [height - MARGIN.bottom, MARGIN.top]),
      plotWidth,
    };
  }, [columns, series, width, height, normalise]);

  if (width === 0) return <div ref={ref} style={{ height }} />;
  if (columns.length === 0) {
    return (
      <div ref={ref} className="chart-empty" style={{ height }}>
        Geen waarden in deze selectie.
      </div>
    );
  }

  const { totals, yTicks, x, y } = model;
  const thickness = Math.min(MAX_BAR_THICKNESS, x.bandwidth);
  const labelStride = Math.max(1, Math.ceil(columns.length / Math.max(2, Math.floor(model.plotWidth / 46))));

  return (
    <div ref={ref} className="chart" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={MARGIN.left - 10} y={y(t) + 4} className="axis-text axis-text--end">
              {normalise ? `${Math.round(t * 100)}%` : formatValue(t)}
            </text>
          </g>
        ))}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} className="axis-line" />

        {columns.map((column, i) => {
          const total = totals[i] ?? 0;
          const left = x(i) + (x.bandwidth - thickness) / 2;
          let cursor = 0;
          const visible = series.filter((s) => (column.values[s.key] ?? 0) > 0);

          return (
            <g key={column.label}>
              {visible.map((s, index) => {
                const raw = column.values[s.key] ?? 0;
                const value = normalise ? (total > 0 ? raw / total : 0) : raw;
                const y0 = y(cursor);
                cursor += value;
                const y1 = y(cursor);
                const isTop = index === visible.length - 1;
                // The 2px gap is taken off the top of every segment but the last,
                // so the stack keeps one consistent separator width.
                const segmentHeight = Math.max(0, y0 - y1 - (isTop ? 0 : SURFACE_GAP));
                const dim = hover !== null && hover !== s.key;
                return (
                  <path
                    key={s.key}
                    d={barPath(left, y1, thickness, segmentHeight, isTop ? CHART_RADIUS : 0, 'up')}
                    fill={s.colour}
                    opacity={dim ? 0.35 : 1}
                  />
                );
              })}

              <rect
                x={x(i)}
                y={MARGIN.top}
                width={x.step}
                height={height - MARGIN.top - MARGIN.bottom}
                fill="transparent"
                onPointerMove={(event) => {
                  const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                  const localY = event.clientY - rect.top;
                  // Name the segment under the pointer so hover can dim the rest.
                  let running = 0;
                  let active: string | null = null;
                  for (const s of visible) {
                    const raw = column.values[s.key] ?? 0;
                    const value = normalise ? (total > 0 ? raw / total : 0) : raw;
                    const y0 = y(running);
                    running += value;
                    if (localY <= y0 && localY >= y(running)) active = s.key;
                  }
                  setHover(active);
                  show({
                    x: x(i) + x.bandwidth / 2,
                    y: MARGIN.top,
                    title: column.label,
                    rows: [
                      ...visible
                        .slice()
                        .reverse()
                        .map((s) => {
                          const raw = column.values[s.key] ?? 0;
                          return {
                            label: s.label,
                            colour: s.colour,
                            value: normalise
                              ? `${((total > 0 ? raw / total : 0) * 100).toFixed(1)}%`
                              : formatValue(raw),
                          };
                        }),
                      { label: 'totaal', value: formatValue(total) },
                    ],
                  });
                }}
                onPointerLeave={() => {
                  setHover(null);
                  hide();
                }}
              />

              {i % labelStride === 0 || i === columns.length - 1 ? (
                <text x={x(i) + x.bandwidth / 2} y={height - 10} className="axis-text axis-text--mid">
                  {column.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
