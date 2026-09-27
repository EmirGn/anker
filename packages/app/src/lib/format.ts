// German formats for the UI: "12 Min.", "4 Tage", "vor 3 Tagen", decimal comma.
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const zahl = (n: number, digits = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: digits });

/** "1 Karte" / "3 Karten" */
export const anzahl = (n: number, one: string, many: string) => `${zahl(n, 0)} ${n === 1 ? one : many}`;

/** Interval until a card comes back: "1 Min.", "6 Std.", "1 Tag", "4 Tage", "1,5 Mon.", "2 J." */
export function intervall(ms: number): string {
  if (ms < MIN) return '< 1 Min.';
  if (ms < HOUR) return `${Math.round(ms / MIN)} Min.`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} Std.`;
  const d = ms / DAY;
  if (d < 30) return anzahl(Math.round(d), 'Tag', 'Tage');
  if (d < 365) return `${zahl(d / 30)} Mon.`;
  return `${zahl(d / 365)} J.`;
}

/** Time spent: "40 Sek.", "12 Min.", "1 Std. 5 Min." */
export function dauer(ms: number): string {
  const total = Math.round(ms / MIN);
  if (total < 1) return `${Math.max(1, Math.round(ms / SEC))} Sek.`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} Min.`;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

/** "gerade eben", "vor 5 Min.", "in 3 Tagen", "vor 1 Jahr" */
export function relativ(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < MIN) return 'gerade eben';
  let s: string;
  if (abs < HOUR) s = `${Math.round(abs / MIN)} Min.`;
  else if (abs < DAY) s = `${Math.round(abs / HOUR)} Std.`;
  else {
    const d = Math.round(abs / DAY);
    if (d < 30) s = d === 1 ? '1 Tag' : `${d} Tagen`;
    else if (d < 365) s = Math.round(d / 30) === 1 ? '1 Monat' : `${Math.round(d / 30)} Monaten`;
    else s = Math.round(d / 365) === 1 ? '1 Jahr' : `${Math.round(d / 365)} Jahren`;
  }
  return diff > 0 ? `in ${s}` : `vor ${s}`;
}

/** "So., 27. Sept." */
export const kurzDatum = (ts: number) => new Date(ts).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

/** "27.09.2026" */
export const datum = (ts: number) => new Date(ts).toLocaleDateString('de-DE');

/** "14:05" */
export const uhrzeit = (ts: number) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
