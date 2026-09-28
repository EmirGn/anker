import { addDaysKey, dayKey, type DayStat } from '@anker/core';
import { useMemo, useState } from 'react';
import { cx } from './ui';
import { lang, LOCALE, tr } from '../lib/i18n';

const WEEKDAYS = lang === 'de' ? ['Mo', '', 'Mi', '', 'Fr', '', ''] : ['Mon', '', 'Wed', '', 'Fri', '', ''];
const MONTHS =
  lang === 'de'
    ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub-style review calendar (columns = weeks, Monday first). */
export function Heatmap({ days, weeks = 20, rolloverHour = 4 }: { days: Map<string, DayStat>; weeks?: number; rolloverHour?: number }) {
  const [hover, setHover] = useState<{ key: string; count: number } | null>(null);
  const grid = useMemo(() => {
    const today = dayKey(Date.now(), rolloverHour);
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
    const start = addDaysKey(today, -(weeks - 1) * 7 - dow);
    const cols: { key: string; count: number; future: boolean }[][] = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const key = addDaysKey(start, w * 7 + i);
        col.push({ key, count: days.get(key)?.count ?? 0, future: key > today });
      }
      cols.push(col);
    }
    return { cols, today };
  }, [days, weeks, rolloverHour]);
  const max = Math.max(10, ...[...days.values()].map((d) => d.count));
  const level = (c: number) => (c === 0 ? 0 : c < max * 0.25 ? 1 : c < max * 0.5 ? 2 : c < max * 0.75 ? 3 : 4);
  const fills = ['var(--paper-sunk)', 'color-mix(in srgb, var(--wiese) 30%, var(--paper-sunk))', 'color-mix(in srgb, var(--wiese) 55%, var(--paper-sunk))', 'color-mix(in srgb, var(--wiese) 80%, var(--paper-sunk))', 'var(--wiese)'];
  return (
    <div className="w-full">
      <div className="flex gap-[3px]">
        <div className="mr-1 flex flex-col gap-[3px] pt-[18px] text-[11px] text-ink-muted">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="flex h-[var(--cell)] items-center leading-none" style={{ ['--cell' as string]: 'clamp(9px, 2.1vw, 13px)' }}>
              {w}
            </div>
          ))}
        </div>
        <div className="flex flex-1 justify-between gap-[3px] overflow-hidden" style={{ ['--cell' as string]: 'clamp(9px, 2.1vw, 13px)' }}>
          {grid.cols.map((col, ci) => {
            const first = col[0]!.key;
            const showMonth = ci === 0 || first.slice(8) <= '07';
            return (
              <div key={ci} className="flex flex-col gap-[3px]">
                <div className="h-[15px] text-[11px] leading-none whitespace-nowrap text-ink-muted">{showMonth ? MONTHS[Number(first.slice(5, 7)) - 1] : ''}</div>
                {col.map((cell) => (
                  <div
                    key={cell.key}
                    onMouseEnter={() => setHover(cell)}
                    onMouseLeave={() => setHover(null)}
                    className={cx('rounded-[3px]', cell.key === grid.today && 'ring-1 ring-hafen ring-offset-1 ring-offset-paper-raised')}
                    style={{
                      width: 'var(--cell)',
                      height: 'var(--cell)',
                      background: cell.future ? 'transparent' : fills[level(cell.count)],
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 h-4 text-[11px] text-ink-muted">
        {hover ? tr('{0}: {1} Wiederholungen', new Date(`${hover.key}T12:00`).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }), hover.count) : ''}
      </div>
    </div>
  );
}

export function Bars({
  values,
  labels,
  height = 120,
  color = 'var(--hafen)',
  highlightFirst,
  format = (v: number) => String(v),
}: {
  values: number[];
  labels?: (string | null)[];
  height?: number;
  color?: string;
  highlightFirst?: boolean;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const n = values.length;
  // A year of days has to fit the same card as a week: thinner gaps, then none.
  const gap = n > 120 ? 0 : n > 45 ? 1 : 3;
  return (
    <div className="min-w-0">
      <div className="flex items-end" style={{ height, gap }}>
        {values.map((v, i) => (
          <div
            key={i}
            className="group relative flex flex-1 flex-col justify-end"
            style={{ height: '100%' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={cx('w-full transition-opacity', n > 120 ? 'rounded-t-[1px]' : 'rounded-t-[4px]')}
              style={{
                height: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`,
                background: v ? color : 'var(--line)',
                opacity: hover === null || hover === i ? (highlightFirst && i > 0 ? 0.75 : 1) : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      {labels && (
        <div className="relative mt-1.5 h-4 text-[11px] text-ink-muted">
          {labels.map((l, i) => {
            if (!l) return null;
            const x = (i + 0.5) / n;
            // Edge labels hug the edge instead of hanging out of the card.
            const edge = x < 0.1 ? 'left' : x > 0.9 ? 'right' : null;
            return (
              <span
                key={i}
                className="absolute top-0 whitespace-nowrap"
                style={edge === 'left' ? { left: 0 } : edge === 'right' ? { right: 0 } : { left: `${x * 100}%`, transform: 'translateX(-50%)' }}
              >
                {l}
              </span>
            );
          })}
        </div>
      )}
      <div className="mt-1 h-4 text-[11px] text-ink-muted">{hover !== null ? `${labels?.[hover] ?? `#${hover + 1}`}: ${format(values[hover]!)}` : ''}</div>
    </div>
  );
}

export function StackedBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper-sunk">
        {parts.map((p) =>
          p.value ? <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} /> : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-1.5 text-[13px]">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-ink-muted">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
