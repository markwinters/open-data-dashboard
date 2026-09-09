import { useMemo, useState } from 'react';
import { CHART_RADIUS, MAX_BAR_THICKNESS, band, barPath, linear } from './core';
import { useMeasure } from './core';
import { ChartTooltip, useTooltip } from './Tooltip';

export interface BarDatum {
  label: string;
  value: number;
  /** Colour follows the entity. Omit for a single-hue chart. */
  colour?: string;
  /** Extra rows for the tooltip - the context the bar length cannot carry. */
  detail?: { label: string; value: string }[];
}

interface BarChartProps {
  data: BarDatum[];
  formatValue?: (value: number) => string;
  /** Row height including its share of the gap. */
  rowHeight?: number;
  /** Width reserved for category names. */
  labelWidth?: number;
  colour?: string;
}

/**
 * Horizontal bars, value at the tip. Horizontal because RDW's category names -
 * marques, body types, defect descriptions - are long, and rotated tick labels
 * are unreadable.
 */
export function BarChart({
  data,
  formatValue = (v) => v.toLocaleString('nl-NL'),
  rowHeight = 30,
  labelWidth = 132,
  colour = 'var(--series-1)',
}: BarChartProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const [hover, setHover] = useState<number | null>(null);

  const valueWidth = 74;
  const height = Math.max(40, data.length * rowHeight + 8);

  const model = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.value));
    // On a narrow card the requested label gutter would leave no room for the
    // bars, so it yields; the labels are then trimmed to what actually fits.
    const gutter = Math.max(40, Math.min(labelWidth, width * 0.45));
    const plotStart = gutter + 12;
    const plotWidth = Math.max(20, width - plotStart - valueWidth);
    return {
      x: linear([0, max], [plotStart, plotStart + plotWidth]),
      y: band(data.length, [4, height - 4], 0.34),
      plotStart,
      gutter,
    };
  }, [data, width, height, labelWidth]);

  if (width === 0) return <div ref={ref} style={{ height }} />;
  if (data.length === 0) {
    return (
      <div ref={ref} className="chart-empty" style={{ height: 80 }}>
        Geen waarden in deze selectie.
      </div>
    );
  }

  const { x, y, plotStart, gutter } = model;
  const thickness = Math.min(MAX_BAR_THICKNESS, y.bandwidth);

  // A label is trimmed to the gutter rather than clipped by it or allowed to
  // run under the bars; the full text stays in the tooltip and the table view.
  const CHAR_WIDTH = 6.1;
  const fit = (label: string) => {
    const max = Math.floor(gutter / CHAR_WIDTH);
    return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`;
  };

  return (
    <div ref={ref} className="chart" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img">
        <line x1={plotStart} x2={plotStart} y1={2} y2={height - 2} className="axis-line" />
        {data.map((d, i) => {
          const top = y(i) + (y.bandwidth - thickness) / 2;
          const barWidth = Math.max(0, x(d.value) - plotStart);
          const fill = d.colour ?? colour;
          return (
            <g
              key={d.label}
              onPointerEnter={(event) => {
                setHover(i);
                const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                show({
                  x: Math.min(x(d.value) + 8, rect.width - 40),
                  y: top,
                  title: d.label,
                  rows: [
                    { label: 'aantal', value: formatValue(d.value), colour: fill },
                    ...(d.detail ?? []).map((row) => ({ label: row.label, value: row.value })),
                  ],
                });
              }}
              onPointerLeave={() => {
                setHover(null);
                hide();
              }}
            >
              {/* Hit target spans the whole row, not just the painted bar. */}
              <rect x={0} y={y(i) - 2} width={width} height={y.step} fill="transparent" />
              <text x={gutter} y={top + thickness / 2 + 4} className="axis-text axis-text--end">
                {fit(d.label)}
              </text>
              <path
                d={barPath(plotStart, top, barWidth, thickness, CHART_RADIUS, 'right')}
                fill={fill}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              <text
                x={x(d.value) + 8}
                y={top + thickness / 2 + 4}
                className="axis-text axis-text--value"
              >
                {formatValue(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
