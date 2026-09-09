import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StatusLevel } from '../lib/palette';

/**
 * The instrument cluster.
 *
 * These three forms exist because the subject supplies them, not because a
 * dashboard needed decorating. A vehicle register is read the way a driver
 * reads a binnacle: a total that only ever climbs is an odometer, a bounded
 * ratio is a dial with a scale and a redline, and the register's own flags —
 * an open manufacturer recall, a missing WAM insurance, an export notice — are
 * literally the lamps a car lights on its own dashboard.
 */

const RAD = Math.PI / 180;

/** Point on a circle. 0° points right; angles run clockwise, as SVG does. */
function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle * RAD), cy + r * Math.sin(angle * RAD)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** True when the viewer has asked for less motion; needles then simply appear. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Eases a number from 0 to `target` once, unless motion is turned down. */
function useSweep(target: number | null, durationMs = 850): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    if (target == null) return;
    if (reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: a needle settles, it does not arrive at full speed.
      setValue(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, durationMs, reduced]);

  return target == null ? 0 : value;
}

/* ------------------------------------------------------------------ gauge -- */

interface GaugeProps {
  label: string;
  /** Value in real units; `null` renders an unpowered dial. */
  value: number | null;
  min?: number;
  max: number;
  /** Formats the digital readout and the scale numbers. */
  format: (value: number) => string;
  unit?: string;
  /** Where the red zone starts, in real units. Omit for a dial with no danger. */
  redlineFrom?: number;
  /** Colour of the swept arc. Defaults to the accent. */
  tone?: StatusLevel;
  /** One line under the readout saying what the scale means. */
  caption?: string;
  size?: number;
}

const SWEEP_START = 135;
const SWEEP_DEGREES = 270;

/**
 * A dial for a bounded ratio. The scale is drawn to whatever range it is given
 * and that range is printed under the readout, so a needle sitting low reads as
 * a small share rather than as a broken instrument.
 */
export function Gauge({
  label,
  value,
  min = 0,
  max,
  format,
  unit,
  redlineFrom,
  tone,
  caption,
  size = 176,
}: GaugeProps) {
  const span = max - min || 1;
  const clamped = value == null ? null : Math.min(max, Math.max(min, value));
  const fraction = clamped == null ? null : (clamped - min) / span;
  const swept = useSweep(fraction);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const angleAt = (t: number) => SWEEP_START + t * SWEEP_DEGREES;

  const toneColour = tone ? `var(--${tone === 'good' ? 'good' : tone})` : 'var(--accent)';
  const inRedline = redlineFrom != null && clamped != null && clamped >= redlineFrom;
  const arcColour = inRedline ? 'var(--redline)' : toneColour;

  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  const [needleX, needleY] = polar(cx, cy, r - 20, angleAt(swept));

  return (
    <figure className="gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value == null ? 'geen waarde' : format(value)}`}>
        {/* Dial face */}
        <circle cx={cx} cy={cy} r={r + 12} className="gauge__face" />
        <circle cx={cx} cy={cy} r={r + 12} className="gauge__bezel" />

        {/* Unswept track */}
        <path
          d={arcPath(cx, cy, r, angleAt(0), angleAt(1))}
          className="gauge__track"
          fill="none"
        />

        {/* The red zone is drawn under the needle, on the scale itself. */}
        {redlineFrom != null ? (
          <path
            d={arcPath(cx, cy, r, angleAt((redlineFrom - min) / span), angleAt(1))}
            className="gauge__redline"
            fill="none"
          />
        ) : null}

        {/* Swept value */}
        {fraction != null ? (
          <path
            d={arcPath(cx, cy, r, angleAt(0), angleAt(Math.max(swept, 0.001)))}
            fill="none"
            stroke={arcColour}
            strokeWidth={5}
            strokeLinecap="round"
          />
        ) : null}

        {/* Scale ticks: majors every 20%, minors between. */}
        {ticks.map((t, i) => {
          const major = i % 2 === 0;
          const [x0, y0] = polar(cx, cy, r - 9, angleAt(t));
          const [x1, y1] = polar(cx, cy, r - (major ? 17 : 13), angleAt(t));
          return (
            <line
              key={t}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              className={major ? 'gauge__tick gauge__tick--major' : 'gauge__tick'}
            />
          );
        })}

        {fraction != null ? (
          <>
            <line x1={cx} y1={cy} x2={needleX} y2={needleY} className="gauge__needle" />
            <circle cx={cx} cy={cy} r={5} className="gauge__hub" />
            <circle cx={cx} cy={cy} r={2} className="gauge__hub-pin" />
          </>
        ) : null}
      </svg>

      <figcaption className="gauge__readout">
        <span className="gauge__label">{label}</span>
        <span className="gauge__value" style={{ color: inRedline ? 'var(--redline)' : undefined }}>
          {value == null ? '—' : format(value)}
          {unit ? <span className="gauge__unit">{unit}</span> : null}
        </span>
        {/* The dial is drawn to whatever range it is given, so the range is
            stated rather than left for the reader to assume it is 0-100%. */}
        <span className="gauge__scale">
          schaal {format(min)}–{format(max)}
          {redlineFrom != null ? ` · rood vanaf ${format(redlineFrom)}` : ''}
        </span>
        {caption ? <span className="gauge__caption">{caption}</span> : null}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------- odometer -- */

interface OdometerProps {
  label: string;
  value: number | null;
  caption: string;
  /** Formatted separately so the drum shows real nl-NL grouping. */
  format: (value: number) => string;
}

/**
 * The headline total, as a mechanical drum readout.
 *
 * A register only ever counts up, which is exactly what an odometer is for -
 * and unlike a dial it needs no upper bound to be honest about.
 */
export function Odometer({ label, value, caption, format }: OdometerProps) {
  const rolled = useSweep(value, 1100);
  const shown = value == null ? null : Math.round(rolled);
  const text = shown == null ? '—' : format(shown);

  return (
    <div className="odometer">
      <p className="odometer__label">{label}</p>
      <div className="odometer__drums" aria-label={value == null ? 'geen waarde' : format(value)}>
        {text.split('').map((char, i) =>
          /[0-9]/.test(char) ? (
            <span className="odometer__digit" key={i} aria-hidden="true">
              {char}
            </span>
          ) : (
            <span className="odometer__sep" key={i} aria-hidden="true">
              {char}
            </span>
          ),
        )}
      </div>
      <p className="odometer__caption">{caption}</p>
    </div>
  );
}

/* -------------------------------------------------------------- telltales -- */

export type TelltaleKind = 'recall' | 'insurance' | 'export' | 'inspection' | 'taxi' | 'odometer';

export interface TelltaleProps {
  kind: TelltaleKind;
  label: string;
  /** Lit lamps are the ones demanding attention. */
  lit: boolean;
  level?: StatusLevel;
  /** What the lamp means, in words - a lamp is never colour alone. */
  detail?: string;
  /** Optional figure, e.g. how many vehicles carry this flag. */
  value?: string;
}

/**
 * A dashboard warning lamp. Icons are built from plain geometry rather than
 * traced path data so they stay crisp and legible at 22px.
 */
function TelltaleIcon({ kind }: { kind: TelltaleKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'recall':
      // Spanner: the service lamp.
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path {...common} d="M15.5 4.5a4.5 4.5 0 0 0-5.9 5.6L4 15.7 6.3 18l5.6-5.6a4.5 4.5 0 0 0 5.6-5.9l-2.5 2.5-2.1-2.1z" />
        </svg>
      );
    case 'insurance':
      // Warning triangle: the statutory cover is missing.
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path {...common} d="M12 4 3 19h18z" />
          <path {...common} d="M12 10v4" />
          <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'export':
      // Arrow leaving the country outline.
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path {...common} d="M13 4H5v16h8" />
          <path {...common} d="M17 8l4 4-4 4M21 12H10" />
        </svg>
      );
    case 'inspection':
      // Clock: the APK is timed.
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle {...common} cx="12" cy="12" r="8" />
          <path {...common} d="M12 7.5V12l3 1.8" />
        </svg>
      );
    case 'taxi':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path {...common} d="M4 16v-3l1.7-4.2A2 2 0 0 1 7.6 7.5h8.8a2 2 0 0 1 1.9 1.3L20 13v3" />
          <path {...common} d="M3.5 16h17M6.5 16v1.8M17.5 16v1.8M10 5h4" />
        </svg>
      );
    case 'odometer':
      // A dial with a needle: the odometer-integrity lamp.
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path {...common} d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0" />
          <path {...common} d="M12 13.5 15.6 9.4" />
          <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

export function Telltale({ kind, label, lit, level = 'warning', detail, value }: TelltaleProps) {
  return (
    <div className={`telltale${lit ? ` telltale--lit telltale--${level}` : ''}`}>
      <span className="telltale__lamp">
        <TelltaleIcon kind={kind} />
      </span>
      <span className="telltale__body">
        <span className="telltale__label">{label}</span>
        {value ? <span className="telltale__value">{value}</span> : null}
        {detail ? <span className="telltale__detail">{detail}</span> : null}
      </span>
    </div>
  );
}

/** The lamp strip. Lit lamps sort to the front, the way attention works. */
export function TelltalePanel({ children }: { children: ReactNode }) {
  return <div className="telltale-strip">{children}</div>;
}
