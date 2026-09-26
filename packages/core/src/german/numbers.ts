const ONES = [
  'null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn',
];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (o === 0) return TENS[t]!;
  return `${o === 1 ? 'ein' : ONES[o]}und${TENS[t]}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = '';
  if (h > 0) s += `${h === 1 ? 'ein' : ONES[h]}hundert`;
  if (r > 0) s += below100(r);
  return s;
}

/** "eins" → "ein" when a number is used in front of tausend/Millionen. */
const compound = (s: string) => (s.endsWith('eins') ? s.slice(0, -1) : s);

/** 347 → "dreihundertsiebenundvierzig", 1_000_001 → "eine Million eins". */
export function numberToGerman(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`numberToGerman: unsupported ${n}`);
  if (n === 0) return 'null';
  if (n < 1000) return below1000(n);
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    return `${compound(below1000(th))}tausend${r ? below1000(r) : ''}`;
  }
  if (n < 1_000_000_000) {
    const m = Math.floor(n / 1_000_000);
    const r = n % 1_000_000;
    const head = m === 1 ? 'eine Million' : `${compound(below1000(m))} Millionen`;
    return r ? `${head} ${numberToGerman(r)}` : head;
  }
  const b = Math.floor(n / 1_000_000_000);
  const r = n % 1_000_000_000;
  const head = b === 1 ? 'eine Milliarde' : `${compound(below1000(b))} Milliarden`;
  return r ? `${head} ${numberToGerman(r)}` : head;
}

/** Years are read in hundreds before 2000: 1984 → "neunzehnhundertvierundachtzig". */
export function yearToGerman(y: number): string {
  if (y >= 1100 && y < 2000) {
    const hi = Math.floor(y / 100);
    const lo = y % 100;
    return `${below100(hi)}hundert${lo ? below100(lo) : ''}`;
  }
  return numberToGerman(y);
}

/** 3.5 → "3,50 €" (German formatting). */
export function formatEuro(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

/** "3,50 €" → "drei Euro fünfzig" */
export function euroToGerman(amount: number): string {
  const euros = Math.floor(amount);
  const cents = Math.round((amount - euros) * 100);
  const e = euros === 1 ? 'ein Euro' : `${numberToGerman(euros)} Euro`;
  if (!cents) return e;
  return `${e} ${numberToGerman(cents)}`;
}

/** Accepted spellings for type-in answers ("einhundert" / "hundert", with/without spaces). */
export function numberSpellings(n: number): string[] {
  const base = numberToGerman(n);
  const set = new Set<string>([base]);
  if (/^ein(hundert|tausend)/.test(base)) set.add(base.replace(/^ein/, ''));
  return [...set];
}

export function normalizeNumberWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/ae/g, 'ä')
    .replace(/oe/g, 'ö')
    .replace(/ue/g, 'ü')
    .replace(/ss/g, 'ß')
    .replace(/[\s\-–]+/g, '')
    .trim();
}
