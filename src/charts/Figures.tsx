import { linePath } from './core';

interface StatTileProps {
  label: string;
  value: string;
  /** Signed change against a named period, e.g. "+2,4 pt vs. 2020". */
  delta?: { text: string; direction: 'up' | 'down' | 'flat'; upIsGood: boolean };
  /** 12-ish points; the last one is drawn in the accent hue. */
  trend?: (number | null)[];
  hint?: string;
  loading?: boolean;
}

/** A 12-point sparkline: context in the de-emphasis hue, the present in accent. */
function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  if (points.length < 2) return null;

  const width = 78;
  const height = 30;
  const ys = points.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const lastIndex = values.length - 1;
  const scaled = points.map(
    ([i, v]) => [(i / Math.max(1, lastIndex)) * width, height - 3 - ((v - min) / span) * (height - 6)] as const,
  );
  const last = scaled[scaled.length - 1]!;

  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <path d={linePath(scaled)} fill="none" stroke="var(--de-emphasis)" strokeWidth={2} strokeLinecap="round" />
      <path
        d={linePath(scaled.slice(-2))}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}

export function StatTile({ label, value, delta, trend, hint, loading = false }: StatTileProps) {
  const good = delta ? (delta.direction === 'up') === delta.upIsGood : false;
  return (
    <div className="stat" aria-busy={loading}>
      <p className="stat__label">{label}</p>
      <p className="stat__value">{loading ? '—' : value}</p>
      <div className="stat__foot">
        {delta ? (
          <span
            className={`stat__delta stat__delta--${delta.direction === 'flat' ? 'flat' : good ? 'good' : 'bad'}`}
          >
            <span aria-hidden="true">
              {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '■'}
            </span>
            {delta.text}
          </span>
        ) : hint ? (
          <span className="stat__hint">{hint}</span>
        ) : (
          <span />
        )}
        {trend ? <Sparkline values={trend} /> : null}
      </div>
    </div>
  );
}
