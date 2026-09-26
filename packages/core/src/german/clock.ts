import { numberToGerman } from './numbers';

function hourWord(h12: number): string {
  return h12 === 1 ? 'eins' : numberToGerman(h12);
}

/** Colloquial time: 7:30 → "halb acht", 3:15 → "Viertel nach drei". Minutes must be a multiple of 5. */
export function informalTime(h24: number, m: number): string {
  const cur = h24 % 12 === 0 ? 12 : h24 % 12;
  const next = (h24 + 1) % 12 === 0 ? 12 : (h24 + 1) % 12;
  switch (m) {
    case 0:
      return `${cur === 1 ? 'ein' : numberToGerman(cur)} Uhr`;
    case 5:
      return `fünf nach ${hourWord(cur)}`;
    case 10:
      return `zehn nach ${hourWord(cur)}`;
    case 15:
      return `Viertel nach ${hourWord(cur)}`;
    case 20:
      return `zwanzig nach ${hourWord(cur)}`;
    case 25:
      return `fünf vor halb ${hourWord(next)}`;
    case 30:
      return `halb ${hourWord(next)}`;
    case 35:
      return `fünf nach halb ${hourWord(next)}`;
    case 40:
      return `zwanzig vor ${hourWord(next)}`;
    case 45:
      return `Viertel vor ${hourWord(next)}`;
    case 50:
      return `zehn vor ${hourWord(next)}`;
    case 55:
      return `fünf vor ${hourWord(next)}`;
    default:
      throw new Error(`informalTime: minutes must be a multiple of 5 (got ${m})`);
  }
}

/** Official 24h time: 13:05 → "dreizehn Uhr fünf", 1:00 → "ein Uhr". */
export function formalTime(h24: number, m: number): string {
  const h = h24 === 1 ? 'ein' : numberToGerman(h24);
  return m ? `${h} Uhr ${numberToGerman(m)}` : `${h} Uhr`;
}

export function digitalTime(h24: number, m: number): string {
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
