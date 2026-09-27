// Numbers, intervals and dates in the UI language:
// German "12 Min.", "4 Tage", "vor 3 Tagen", decimal comma; English "12 min", "4 days", "3 days ago".
import { lang, LOCALE, tr } from './i18n';

const DE = lang === 'de';
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const zahl = (n: number, digits = 1) => n.toLocaleString(LOCALE, { maximumFractionDigits: digits });

/** A count with its noun, from two translation keys: anzahl(3, '{0} Karte', '{0} Karten') → "3 Karten" / "3 cards". */
export const anzahl = (n: number, one: string, many: string) => tr(n === 1 ? one : many, zahl(n, 0));

/** Interval until a card comes back: "1 Min.", "6 Std.", "4 Tage", "1,5 Mon." / "1 min", "6 h", "4 days", "1.5 mo". */
export function intervall(ms: number): string {
  if (ms < MIN) return DE ? '< 1 Min.' : '< 1 min';
  if (ms < HOUR) return `${Math.round(ms / MIN)} ${DE ? 'Min.' : 'min'}`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} ${DE ? 'Std.' : 'h'}`;
  const d = ms / DAY;
  if (d < 30) return anzahl(Math.round(d), '{0} Tag', '{0} Tage');
  if (d < 365) return `${zahl(d / 30)} ${DE ? 'Mon.' : 'mo'}`;
  return `${zahl(d / 365)} ${DE ? 'J.' : 'y'}`;
}

/** Time spent: "40 Sek.", "12 Min.", "1 Std. 5 Min." / "40 s", "12 min", "1 h 5 min". */
export function dauer(ms: number): string {
  const [s, m, h] = DE ? ['Sek.', 'Min.', 'Std.'] : ['s', 'min', 'h'];
  const total = Math.round(ms / MIN);
  if (total < 1) return `${Math.max(1, Math.round(ms / SEC))} ${s}`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} ${m}`;
  return mins ? `${hours} ${h} ${mins} ${m}` : `${hours} ${h}`;
}

/** "gerade eben", "vor 5 Min.", "in 3 Tagen" / "just now", "5 min ago", "in 3 days". */
export function relativ(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < MIN) return DE ? 'gerade eben' : 'just now';
  let s: string;
  if (abs < HOUR) s = `${Math.round(abs / MIN)} ${DE ? 'Min.' : 'min'}`;
  else if (abs < DAY) s = `${Math.round(abs / HOUR)} ${DE ? 'Std.' : 'h'}`;
  else {
    const d = Math.round(abs / DAY);
    const mo = Math.round(d / 30);
    const y = Math.round(d / 365);
    if (DE) s = d < 30 ? (d === 1 ? '1 Tag' : `${d} Tagen`) : d < 365 ? (mo === 1 ? '1 Monat' : `${mo} Monaten`) : y === 1 ? '1 Jahr' : `${y} Jahren`;
    else s = d < 30 ? (d === 1 ? '1 day' : `${d} days`) : d < 365 ? (mo === 1 ? '1 month' : `${mo} months`) : y === 1 ? '1 year' : `${y} years`;
  }
  if (DE) return diff > 0 ? `in ${s}` : `vor ${s}`;
  return diff > 0 ? `in ${s}` : `${s} ago`;
}

/** "So., 27. Sept." / "Sun 27 Sept" */
export const kurzDatum = (ts: number) => new Date(ts).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

/** "27.09.2026" / "27/09/2026" */
export const datum = (ts: number) => new Date(ts).toLocaleDateString(LOCALE);

/** "14:05" */
export const uhrzeit = (ts: number) => new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
