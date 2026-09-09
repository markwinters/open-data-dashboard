import { useMemo, useState } from 'react';
import { linear, niceTicks, useMeasure } from './core';
import { ChartTooltip, useTooltip } from './Tooltip';

export interface ScatterPoint {
  x: number;
  y: number;
  /** Series key - capped at three, the all-pairs limit for this palette. */
  group: string;
  label: string;
  detail?: { label: string; value: string }[];
}

export interface ScatterGroup {
  key: string;
  label: string;
  colour: string;
}

interface ScatterChartProps {
  points: ScatterPoint[];
  groups: ScatterGroup[];
  height?: number;
  xLabel: string;
  yLabel: string;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
}

const MARGIN = { top: 16, right: 16, bottom: 44, left: 56 };
const RADIUS = 4.5;

/**
 * Scatter, for the relationships a bar chart cannot show - mass against CO2,
 * price against range. Hit-testing is nearest-point rather than per-mark: an
 * 8px dot is a pinpoint nobody lands on, so the pointer only has to be closest.
 */
export function ScatterChart({
  points,
  groups,
  height = 320,
  xLabel,
  yLabel,
  formatX = (v) => v.toLocaleString('nl-NL'),
  formatY = (v) => v.toLocaleString('nl-NL'),
}: ScatterChartProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const [active, setActive] = useState<number | null>(null);

  const model = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5);
    const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 4);
    return {
      x: linear(
        [Math.min(...xs, xTicks[0] ?? 0), Math.max(...xs, xTicks[xTicks.length - 1] ?? 1)],
        [MARGIN.left, Math.max(MARGIN.left + 10, width - MARGIN.right)],
      ),
      y: linear(
        [Math.min(...ys, yTicks[0] ?? 0), Math.max(...ys, yTicks[yTicks.length - 1] ?? 1)],
        [height - MARGIN.bottom, MARGIN.top],
      ),
      xTicks,
      yTicks,
    };
  }, [points, width, height]);

  if (width === 0) return <div ref={ref} style={{ height }} />;
  if (!model) {
    return (
      <div ref={ref} className="chart-empty" style={{ height }}>
        Geen waarden in deze selectie.
      </div>
    );
  }

  const { x, y, xTicks, yTicks } = model;
  const colourOf = (group: string) => groups.find((g) => g.key === group)?.colour ?? 'var(--de-emphasis)';

  const handleMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best = Infinity;
    let index: number | null = null;
    points.forEach((point, i) => {
      const dx = x(point.x) - px;
      const dy = y(point.y) - py;
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        index = i;
      }
    });
    // ~26px of slack, so the pointer only has to be near.
    if (index === null || best > 26 * 26) {
      setActive(null);
      hide();
      return;
    }
    const point = points[index]!;
    setActive(index);
    show({
      x: x(point.x),
      y: Math.max(MARGIN.top, y(point.y) - 12),
      title: point.label,
      rows: [
        { label: yLabel, value: formatY(point.y), colour: colourOf(point.group) },
        { label: xLabel, value: formatX(point.x) },
        ...(point.detail ?? []),
      ],
    });
  };

  return (
    <div ref={ref} className="chart" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={MARGIN.left - 10} y={y(t) + 4} className="axis-text axis-text--end">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={height - 24} className="axis-text axis-text--mid">
            {formatX(t)}
          </text>
        ))}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(yTicks[0] ?? 0)} y2={y(yTicks[0] ?? 0)} className="axis-line" />

        <text x={width / 2} y={height - 6} className="axis-text axis-text--mid axis-text--muted">
          {xLabel}
        </text>

        {points.map((point, i) => (
          <circle
            key={`${point.label}-${i}`}
            cx={x(point.x)}
            cy={y(point.y)}
            r={active === i ? RADIUS + 1.5 : RADIUS}
            fill={colourOf(point.group)}
            fillOpacity={active === null || active === i ? 0.82 : 0.34}
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
        ))}

        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={Math.max(0, width - MARGIN.left - MARGIN.right)}
          height={Math.max(0, height - MARGIN.top - MARGIN.bottom)}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => {
            setActive(null);
            hide();
          }}
        />
      </svg>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
