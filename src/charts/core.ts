/** Scales, ticks and measurement - the arithmetic every chart shares. */

import { useEffect, useRef, useState } from 'react';

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export interface BandScale {
  (index: number): number;
  bandwidth: number;
  step: number;
}

/** Evenly spaced categorical slots with `padding` (0..1) of the step left as air. */
export function band(count: number, range: [number, number], padding = 0.28): BandScale {
  const [r0, r1] = range;
  const step = count > 0 ? (r1 - r0) / count : r1 - r0;
  const bandwidth = Math.max(1, step * (1 - padding));
  const fn = ((index: number) => r0 + index * step + (step - bandwidth) / 2) as BandScale;
  fn.bandwidth = bandwidth;
  fn.step = step;
  return fn;
}

/** Axis ticks on 1/2/5×10ⁿ boundaries, so labels read as round numbers. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const span = max - min;
  const rawStep = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return ticks;
}

/** Rounds a domain outward to the next tick, so the top mark is not clipped. */
export function niceDomain(min: number, max: number, target = 5): [number, number] {
  const ticks = niceTicks(min, max, target);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : Math.abs(max - min) || 1;
  return [Math.min(min, ticks[0] ?? min), Math.max(max, (ticks[ticks.length - 1] ?? max) + (max > (ticks[ticks.length - 1] ?? max) ? step : 0))];
}

/** Width of the element, tracked so charts re-lay out with the container. */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * A rounded-at-one-end bar path: the data end is rounded, the baseline end
 * stays square, so the mark sits flat on the axis it grows from.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  orientation: 'up' | 'right',
): string {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (w <= 0 || h <= 0) return '';
  if (orientation === 'up') {
    const r = Math.min(radius, w / 2, h);
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  }
  const r = Math.min(radius, h / 2, w);
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

/** A monotone-safe polyline through points, as a path string. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return '';
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export const CHART_RADIUS = 4;
export const SURFACE_GAP = 2;
export const MAX_BAR_THICKNESS = 24;
