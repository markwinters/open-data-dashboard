import { linePath } from './core';
import { STATUS, type StatusLevel } from '../lib/palette';

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

interface HeroProps {
  label: string;
  value: string;
  unit?: string;
  caption: string;
}

/** The one number the dashboard leads with. Exactly one per view. */
export function HeroFigure({ label, value, unit, caption }: HeroProps) {
  return (
    <div className="hero">
      <p className="hero__label">{label}</p>
      <p className="hero__value">
        {value}
        {unit ? <span className="hero__unit">{unit}</span> : null}
      </p>
      <p className="hero__caption">{caption}</p>
    </div>
  );
}

interface MeterProps {
  label: string;
  /** 0..1 */
  fraction: number;
  valueText: string;
  level?: StatusLevel;
  /** The icon + label pairing that keeps a status from being colour-alone. */
  statusText?: string;
}

/**
 * A single ratio against its whole. The unfilled track is a lighter step of the
 * same ramp, so state reads across the whole bar rather than only the fill.
 */
export function Meter({ label, fraction, valueText, level, statusText }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const fill = level ? STATUS[level] : 'var(--seq-450)';
  const icon = level === 'critical' ? '▲' : level === 'serious' ? '▲' : level === 'warning' ? '●' : '✓';
  return (
    <div className="meter">
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{valueText}</span>
      </div>
      <div className="meter__track" role="img" aria-label={`${label}: ${valueText}`}>
        <span className="meter__fill" style={{ width: `${clamped * 100}%`, background: fill }} />
      </div>
      {statusText ? (
        <p className={`meter__status meter__status--${level ?? 'good'}`}>
          <span aria-hidden="true">{icon}</span>
          {statusText}
        </p>
      ) : null}
    </div>
  );
}
