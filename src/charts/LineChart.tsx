import { useMemo } from 'react';
import { CHART_RADIUS, linePath, linear, niceTicks, useMeasure } from './core';
import { ChartTooltip, useTooltip } from './Tooltip';

export interface LinePoint {
  x: number;
  y: number | null;
}

export interface LineSeries {
  key: string;
  label: string;
  colour: string;
  points: LinePoint[];
}

interface LineChartProps {
  series: LineSeries[];
  height?: number;
  formatY?: (value: number) => string;
  formatX?: (value: number) => string;
  /**
   * Value shown on hover. Axis ticks are abbreviated to stay legible, but the
   * tooltip is where a reader goes for the real number, so it defaults to
   * `formatY` and should be given the exact formatter wherever they differ.
   */
  formatExact?: (value: number) => string;
  /** Unit shown in the tooltip after the value. */
  unit?: string;
  /** Draw a 10%-opacity wash under the line. Single-series charts only. */
  area?: boolean;
  /** Start the y-axis at zero even when the data sits well above it. */
  zeroBaseline?: boolean;
}

const MARGIN = { top: 18, right: 76, bottom: 30, left: 52 };

export function LineChart({
  series,
  height = 260,
  formatY = (v) => v.toLocaleString('nl-NL'),
  formatX = (v) => String(v),
  formatExact,
  unit,
  area = false,
  zeroBaseline = true,
}: LineChartProps) {
  const exact = formatExact ?? formatY;
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();

  const model = useMemo(() => {
    const values = series.flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y != null));
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    if (values.length === 0 || xs.length === 0) return null;

    const rawMax = Math.max(...values);
    const rawMin = zeroBaseline ? 0 : Math.min(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.max(1, rawMax * 0.08);
    const yTicks = niceTicks(rawMin, rawMax + pad, 4);
    const yMax = Math.max(rawMax, yTicks[yTicks.length - 1] ?? rawMax);
    const yMin = Math.min(rawMin, yTicks[0] ?? rawMin);

    const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const x = linear([xs[0]!, xs[xs.length - 1]!], [MARGIN.left, MARGIN.left + plotWidth]);
    const y = linear([yMin, yMax], [MARGIN.top + plotHeight, MARGIN.top]);

    // Roughly one label per 64px, so ticks never collide on a narrow card.
    const stride = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(plotWidth / 64))));
    return { xs, x, y, yTicks, plotWidth, plotHeight, stride };
  }, [series, width, height, zeroBaseline]);

  if (width === 0) return <div ref={ref} style={{ height }} />;
  if (!model) {
    return (
      <div ref={ref} style={{ height }} className="chart-empty">
        Geen waarden in deze selectie.
      </div>
    );
  }

  const { xs, x, y, yTicks, stride } = model;
  const showEndLabels = series.length <= 4;

  const handleMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left + MARGIN.left;
    // The crosshair snaps to the nearest x, so the reader aims at a year.
    let nearest = xs[0]!;
    let best = Infinity;
    for (const candidate of xs) {
      const distance = Math.abs(x(candidate) - px);
      if (distance < best) {
        best = distance;
        nearest = candidate;
      }
    }
    // One tooltip lists every series at that x - no need to land on a line.
    const rows = series
      .map((s) => {
        const point = s.points.find((p) => p.x === nearest);
        return point && point.y != null
          ? { label: s.label, value: `${exact(point.y)}${unit ? ` ${unit}` : ''}`, colour: s.colour }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    if (rows.length === 0) {
      hide();
      return;
    }
    show({ x: x(nearest), y: MARGIN.top + 4, title: formatX(nearest), rows });
  };

  return (
    <div ref={ref} className="chart" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img">
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(t)}
              y2={y(t)}
              className="grid-line"
            />
            <text x={MARGIN.left - 10} y={y(t) + 4} className="axis-text axis-text--end">
              {formatY(t)}
            </text>
          </g>
        ))}

        <line
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={y(yTicks[0] ?? 0)}
          y2={y(yTicks[0] ?? 0)}
          className="axis-line"
        />

        {xs
          .filter((_, i) => i % stride === 0 || i === xs.length - 1)
          .map((value) => (
            <text key={value} x={x(value)} y={height - 10} className="axis-text axis-text--mid">
              {formatX(value)}
            </text>
          ))}

        {tip ? (
          <line x1={tip.x} x2={tip.x} y1={MARGIN.top} y2={height - MARGIN.bottom} className="crosshair" />
        ) : null}

        {area && series.length === 1 && series[0]
          ? (() => {
              const s = series[0];
              const defined = s.points.filter((p): p is { x: number; y: number } => p.y != null);
              if (defined.length < 2) return null;
              const base = y(yTicks[0] ?? 0);
              const top = linePath(defined.map((p) => [x(p.x), y(p.y)] as const));
              return (
                <path
                  d={`${top} L${x(defined[defined.length - 1]!.x)},${base} L${x(defined[0]!.x)},${base} Z`}
                  fill={s.colour}
                  opacity={0.1}
                />
              );
            })()
          : null}

        {series.map((s) => {
          const defined = s.points.filter((p): p is { x: number; y: number } => p.y != null);
          if (defined.length === 0) return null;
          const last = defined[defined.length - 1]!;
          return (
            <g key={s.key}>
              <path
                d={linePath(defined.map((p) => [x(p.x), y(p.y)] as const))}
                fill="none"
                stroke={s.colour}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* A 2px surface ring keeps the end dot legible where lines cross. */}
              <circle
                cx={x(last.x)}
                cy={y(last.y)}
                r={CHART_RADIUS}
                fill={s.colour}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
              {showEndLabels ? (
                <text x={x(last.x) + 10} y={y(last.y) + 4} className="axis-text axis-text--series">
                  {s.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {tip
          ? series.map((s) => {
              const point = s.points.find((p) => Math.abs(x(p.x) - tip.x) < 0.5);
              if (!point || point.y == null) return null;
              return (
                <circle
                  key={`hover-${s.key}`}
                  cx={x(point.x)}
                  cy={y(point.y)}
                  r={CHART_RADIUS + 1}
                  fill={s.colour}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              );
            })
          : null}

        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={Math.max(0, width - MARGIN.left - MARGIN.right)}
          height={Math.max(0, height - MARGIN.top - MARGIN.bottom)}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={hide}
        />
      </svg>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
