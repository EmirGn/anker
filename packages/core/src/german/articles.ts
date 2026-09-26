import type { Gender, PartOfSpeech } from '../types';

export const GENDERS: Gender[] = ['der', 'die', 'das', 'pl'];
export const GENDER_ARTICLE: Record<Gender, string> = { der: 'der', die: 'die', das: 'das', pl: 'die' };
export const GENDER_NAME: Record<Gender, string> = {
  der: 'maskulin',
  die: 'feminin',
  das: 'neutrum',
  pl: 'Plural',
};

export function parseGender(s?: string | null): Gender | null {
  const v = (s ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (['der', 'm', 'masc', 'masculine', 'maskulin', 'maskulinum'].includes(v)) return 'der';
  if (['die', 'f', 'fem', 'feminine', 'feminin', 'femininum'].includes(v)) return 'die';
  if (['das', 'n', 'neut', 'neuter', 'neutral', 'neutrum'].includes(v)) return 'das';
  if (['pl', 'plural', 'die (pl)', 'die (pl.)', 'plural only'].includes(v)) return 'pl';
  return null;
}

/** "der Tisch" → { gender: 'der', word: 'Tisch' } */
export function splitArticle(input: string): { gender: Gender | null; word: string } {
  const m = input.trim().match(/^(der|die|das)\s+(\S.*)$/i);
  if (!m) return { gender: null, word: input.trim() };
  return { gender: m[1]!.toLowerCase() as Gender, word: m[2]!.trim() };
}

export function withArticle(word: string, gender?: string | null): string {
  const g = parseGender(gender);
  return g ? `${GENDER_ARTICLE[g]} ${word}` : word;
}

export function pluralDisplay(plural?: string | null): string | null {
  const p = (plural ?? '').trim();
  if (!p) return null;
  if (/^[-–—]$/.test(p) || /^(kein|no |none|nur sg|only sg)/i.test(p)) return 'kein Plural';
  if (/^[-¨"]/.test(p)) return p;
  if (/^die\s/i.test(p)) return p;
  return `die ${p}`;
}

const POS_ALIASES: Record<string, PartOfSpeech> = {
  n: 'noun', noun: 'noun', nomen: 'noun', substantiv: 'noun', substantive: 'noun',
  v: 'verb', verb: 'verb',
  adj: 'adjective', adjective: 'adjective', adjektiv: 'adjective',
  adv: 'adverb', adverb: 'adverb',
  prep: 'preposition', preposition: 'preposition', präposition: 'preposition', praeposition: 'preposition',
  conj: 'conjunction', conjunction: 'conjunction', konjunktion: 'conjunction',
  pron: 'pronoun', pronoun: 'pronoun', pronomen: 'pronoun',
  phrase: 'phrase', expression: 'phrase', ausdruck: 'phrase', redewendung: 'phrase', idiom: 'phrase',
  other: 'other',
};

export function parsePos(s?: string | null): PartOfSpeech | '' {
  const v = (s ?? '').trim().toLowerCase().replace(/\.$/, '');
  return POS_ALIASES[v] ?? (v ? 'other' : '');
}

/** Clean up a "word" note: pull the article out of the German field, normalise gender/pos/plural. */
export function normalizeWordFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = typeof v === 'string' ? v.trim() : String(v ?? '');
  const split = splitArticle(out.german ?? '');
  if (split.gender) {
    if (!out.gender) out.gender = split.gender;
    out.german = split.word;
  }
  const g = parseGender(out.gender);
  out.gender = g ?? '';
  if (g && !out.pos) out.pos = 'noun';
  out.pos = parsePos(out.pos);
  if (out.plural) out.plural = out.plural.replace(/^die\s+/i, '');
  return out;
}
