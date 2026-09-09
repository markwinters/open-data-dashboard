import { useCallback, useState } from 'react';

export interface TooltipRow {
  label: string;
  value: string;
  colour?: string;
}

export interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: TooltipRow[];
}

export function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show: setTip, hide };
}

/**
 * The hover readout. Values lead and labels follow - the reader already has the
 * series and wants the number - and each row keys its series with a short
 * stroke rather than a filled box.
 *
 * Labels come from RDW's own columns, so they are set with React's text
 * interpolation, never as markup.
 */
export function ChartTooltip({ tip, width }: { tip: TooltipState | null; width: number }) {
  if (!tip) return null;
  const estimated = 190;
  const flip = tip.x + estimated + 16 > width;
  return (
    <div
      className="tooltip"
      role="status"
      style={{
        left: flip ? undefined : tip.x + 14,
        right: flip ? Math.max(8, width - tip.x + 14) : undefined,
        top: tip.y,
      }}
    >
      <p className="tooltip__title">{tip.title}</p>
      <ul>
        {tip.rows.map((row, i) => (
          <li key={`${row.label}-${i}`}>
            {row.colour ? (
              <span className="tooltip__key" style={{ background: row.colour }} aria-hidden="true" />
            ) : (
              <span className="tooltip__key tooltip__key--none" aria-hidden="true" />
            )}
            <span className="tooltip__value">{row.value}</span>
            <span className="tooltip__label">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
