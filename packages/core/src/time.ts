export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Start of the current study day (local time). Days roll over at `rolloverHour` (Anki default: 4am). */
export function dayStartMs(now: number, rolloverHour = 4): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), rolloverHour, 0, 0, 0);
  if (d.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start.getTime();
}

export function nextDayStartMs(now: number, rolloverHour = 4): number {
  const s = new Date(dayStartMs(now, rolloverHour));
  s.setDate(s.getDate() + 1);
  return s.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar key (YYYY-MM-DD) of the study day containing `ts`. */
export function dayKey(ts: number, rolloverHour = 4): string {
  const d = new Date(dayStartMs(ts, rolloverHour));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + days, 12);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Compact interval label like Anki: "<1m", "10m", "3h", "4d", "1.5mo", "2.1y". */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return '<1m';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim1(days / 30)}mo`;
  return `${trim1(days / 365)}y`;
}

function trim1(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Human "in 3 days" / "2h ago" style relative time. */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const label = abs < MINUTE ? 'now' : formatInterval(abs);
  if (label === 'now') return 'now';
  return diff > 0 ? `in ${label}` : `${label} ago`;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / MINUTE);
  if (totalMin < 1) return `${Math.max(1, Math.round(ms / SECOND))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
