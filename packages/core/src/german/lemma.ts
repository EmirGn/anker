// A small rule-based German lemmatizer: it doesn't know the language, it only
// proposes dictionary forms ("schlafe" → schlafen, "Häuser" → Haus, "kleinen" →
// klein) that the word index (lookup.ts) then checks against real entries.
// Irregular forms (fährt, ging, gefahren) come from the entries' own `forms`
// and `plural` fields, not from rules here.

/** Which kind of entry a candidate may match. */
export type CandidatePos = 'any' | 'noun' | 'verb' | 'adjective';

export interface LemmaCandidate {
  /** Lower-case form to look up */
  form: string;
  pos: CandidatePos;
  /** Which rule produced it (for debugging and tests) */
  rule: string;
  /** Lower is more plausible; 0 = the word itself */
  cost: number;
}

/** Particles of separable verbs that stand at the end of a clause ("Ich stehe früh auf"). */
export const SEPARABLE_PARTICLES = [
  'ab', 'an', 'auf', 'aus', 'bei', 'dabei', 'dazu', 'durch', 'ein', 'fern', 'fest', 'fort', 'her', 'herein', 'heraus',
  'herum', 'hin', 'hinaus', 'kennen', 'los', 'mit', 'nach', 'statt', 'teil', 'um', 'vor', 'vorbei', 'weg', 'weh', 'weiter',
  'wieder', 'zu', 'zurück', 'zusammen', 'fertig', 'frei', 'kaputt', 'sauber', 'spazieren',
];
const PARTICLE_SET = new Set(SEPARABLE_PARTICLES);
// Longest first, so "herein" wins over "her".
const PARTICLES_BY_LENGTH = [...SEPARABLE_PARTICLES].sort((a, b) => b.length - a.length);

export function isSeparableParticle(word: string): boolean {
  return PARTICLE_SET.has(word.toLowerCase());
}

/** The separable particle a verb infinitive starts with ("aufstehen" → auf), if any. */
export function separablePrefix(infinitive: string): string | null {
  const w = infinitive.toLowerCase();
  for (const p of PARTICLES_BY_LENGTH) {
    if (w.startsWith(p) && w.length - p.length >= 4 && /[aeiouäöüy]/.test(w.slice(p.length))) return p;
  }
  return null;
}

const UMLAUT_BACK: Record<string, string> = { ä: 'a', ö: 'o', ü: 'u' };

/** Undo the last umlaut ("häuser" → "hauser", "bäume" → "baume"); null if there is none. */
export function unumlaut(s: string): string | null {
  for (let i = s.length - 1; i >= 0; i--) {
    const back = UMLAUT_BACK[s[i]!];
    if (back) return s.slice(0, i) + back + s.slice(i + 1);
  }
  return null;
}

const VERB_ENDINGS: [string, number][] = [
  ['e', 1], ['st', 1], ['t', 1], ['en', 0.5], ['n', 1.5], ['est', 1.2], ['et', 1.2],
  ['te', 1.5], ['test', 1.6], ['ten', 1.5], ['tet', 1.6], ['ete', 1.6], ['etest', 1.7], ['eten', 1.6], ['etet', 1.7],
];
const NOUN_ENDINGS: [string, number][] = [
  ['e', 1], ['en', 1], ['n', 1], ['er', 1.2], ['s', 1], ['es', 1.2], ['ern', 1.4], ['ens', 1.6], ['nen', 1.2],
];
const ADJ_ENDINGS: [string, number][] = [
  ['e', 1], ['en', 1], ['em', 1], ['er', 1], ['es', 1],
  // comparative
  ['ere', 1.6], ['eren', 1.6], ['erem', 1.6], ['erer', 1.6], ['eres', 1.6],
  // superlative
  ['ste', 1.8], ['sten', 1.8], ['stem', 1.8], ['ster', 1.8], ['stes', 1.8],
  ['este', 1.9], ['esten', 1.9], ['estem', 1.9], ['ester', 1.9], ['estes', 1.9],
];

/**
 * Possible dictionary forms of one German word, most plausible first.
 * Rules only — every candidate still has to be confirmed by a real entry.
 */
export function lemmaCandidates(word: string): LemmaCandidate[] {
  const w = word.toLowerCase().replace(/[’']s$/, '');
  const out = new Map<string, LemmaCandidate>();
  const add = (form: string, pos: CandidatePos, rule: string, cost: number) => {
    if (form.length < 2) return;
    const key = `${pos}:${form}`;
    const prev = out.get(key);
    if (!prev || prev.cost > cost) out.set(key, { form, pos, rule, cost });
  };
  add(w, 'any', 'exact', 0);
  if (w.length < 3) return [...out.values()];

  // ---- verbs: conjugated forms → infinitive
  for (const [end, cost] of VERB_ENDINGS) {
    if (!w.endsWith(end) || w.length - end.length < 2) continue;
    const stem = w.slice(0, -end.length);
    if (stem.length < 2) continue;
    add(`${stem}en`, 'verb', `-${end}`, cost);
    // wandere/wanderst → wandern, sammelt → sammeln
    if (/(el|er)$/.test(stem)) add(`${stem}n`, 'verb', `-${end}`, cost + 0.2);
    // sammle → sammeln, wandre → wandern
    if (/[^aeiouäöü][lr]$/.test(stem)) add(`${stem.slice(0, -1)}e${stem.slice(-1)}n`, 'verb', `-${end}`, cost + 0.4);
  }
  // imperative / bare stem: mach → machen, setz → setzen
  if (!/[aeiouäöü]$/.test(w) || w.endsWith('e')) add(`${w.replace(/e$/, '')}en`, 'verb', 'stem', 1.3);
  // zu-infinitive: aufzustehen → aufstehen
  for (const p of PARTICLES_BY_LENGTH) {
    if (w.startsWith(`${p}zu`) && w.length > p.length + 5 && w.endsWith('n')) add(p + w.slice(p.length + 2), 'verb', 'zu-infinitive', 1);
  }

  // ---- participles: gekauft → kaufen, geschlafen → schlafen, eingekauft → einkaufen
  const participle = (core: string, prefix: string, rule: string) => {
    if (core.length < 2) return;
    if (core.endsWith('et')) add(`${prefix}${core.slice(0, -2)}en`, 'verb', rule, 1.2);
    if (core.endsWith('t')) add(`${prefix}${core.slice(0, -1)}en`, 'verb', rule, 1.1);
    if (core.endsWith('en')) add(`${prefix}${core}`, 'verb', rule, 1.1);
  };
  if (w.startsWith('ge') && w.length > 5) participle(w.slice(2), '', 'participle');
  for (const p of PARTICLES_BY_LENGTH) {
    if (w.startsWith(`${p}ge`) && w.length > p.length + 5) participle(w.slice(p.length + 2), p, 'participle-separable');
  }
  // besucht / verkauft (inseparable prefix, no ge-) are covered by the -t rule above.

  // ---- nouns: plural / case endings, umlaut plurals
  for (const [end, cost] of NOUN_ENDINGS) {
    if (!w.endsWith(end) || w.length - end.length < 2) continue;
    const base = w.slice(0, -end.length);
    add(base, 'noun', `-${end}`, cost);
    const back = unumlaut(base);
    if (back && (end === 'e' || end === 'er' || end === 'ern' || end === 'en')) add(back, 'noun', `¨-${end}`, cost + 0.5);
  }
  const back = unumlaut(w);
  if (back) {
    add(back, 'noun', '¨', 1.4); // Mütter → Mutter, Gärten → Garten
    if (back.endsWith('n')) add(back.slice(0, -1), 'noun', '¨-n', 1.8); // Vätern → Vater
  }

  // ---- adjectives: declension, comparative, superlative
  for (const [end, cost] of ADJ_ENDINGS) {
    if (!w.endsWith(end) || w.length - end.length < 2) continue;
    const base = w.slice(0, -end.length);
    add(base, 'adjective', `-${end}`, cost);
    const back2 = unumlaut(base);
    if (back2 && cost > 1) add(back2, 'adjective', `¨-${end}`, cost + 0.3); // größere → groß
  }
  // comparative without ending: kleiner (er-ending above) / größer → groß
  if (w.endsWith('er')) {
    const b = unumlaut(w.slice(0, -2));
    if (b) add(b, 'adjective', '¨-er', 1.5);
  }

  return [...out.values()].sort((a, b) => a.cost - b.cost);
}

/** Expand a plural field ("Häuser", "-e", "¨-er", "-") into the actual plural, or null. */
export function expandPlural(word: string, plural: string | undefined | null): string | null {
  const p = (plural ?? '').trim().replace(/^die\s+/i, '');
  if (!p || /^[-–—]$/.test(p) || /^(kein|no |none|nur sg|only sg)/i.test(p)) return null;
  if (/^[-¨"]/.test(p)) {
    // Dictionary shorthand: "-e", "¨-er", "-n", "¨"
    const suffix = p.replace(/[-¨"\s]/g, '');
    let base = word;
    if (/[¨"]/.test(p)) {
      const m = /^(.*?)(au|a|o|u)([^aou]*)$/i.exec(word);
      const UM: Record<string, string> = { au: 'äu', a: 'ä', o: 'ö', u: 'ü' };
      if (m) base = m[1]! + UM[m[2]!.toLowerCase()]! + m[3]!;
    }
    return base + suffix;
  }
  return p.split(/[\s,;/]+/)[0] ?? null;
}

// ------------------------------------------------------------------ text helpers

export interface Token {
  word: string;
  start: number;
  end: number;
}

const WORD_RE = /\p{L}+(?:[-'’]\p{L}+)*/gu;

/** Words of a German text with their character offsets. */
export function tokenizeGerman(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) out.push({ word: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** Characters that end a clause (where a separable particle would stand). */
export const CLAUSE_BREAK = /[.,;:!?()[\]{}"„“”«»–—\n→=|]/;
const SENTENCE_BREAK = /[.!?:;\n→=|]/;

/** The sentence around a character offset (for AI context). */
export function sentenceAt(text: string, offset: number): string {
  let s = offset;
  while (s > 0 && !SENTENCE_BREAK.test(text[s - 1]!)) s--;
  let e = offset;
  while (e < text.length && !SENTENCE_BREAK.test(text[e]!)) e++;
  if (e < text.length && /[.!?]/.test(text[e]!)) e++;
  return text.slice(s, e).replace(/\s+/g, ' ').trim();
}

const DE_MARKERS = new Set(
  'der die das den dem des ein eine einen einem einer und ist ich du er sie es wir ihr nicht mit auf für ich bin bist sind hat habe haben im am zum zur ins vom beim mein meine dein deine kein keine sehr auch noch schon wie was wo wer wann warum heute morgen gestern gern gerne aber oder weil dass wenn mich mir dich dir uns euch ihm ihn ihnen man sich zu von bei nach aus seit über unter vor hinter neben zwischen durch ohne gegen um jetzt hier dort dann nur ja nein doch mal bitte danke'.split(' '),
);
const EN_MARKERS = new Set(
  'the a an and is are was were be been to of in on at for with you your my it this that these those i he she we they them his her our their have has had do does did not no yes can will would should could from by as or but if when what where who why how which there here about into than then so very also just get got me us him please thank thanks one some any'.split(' '),
);

/**
 * Rough language guess for a piece of card text: 'de', 'en', or null when it can't tell
 * (a single word without umlauts, a name …).
 */
export function guessLanguage(text: string): 'de' | 'en' | null {
  let de = 0;
  let en = 0;
  for (const { word } of tokenizeGerman(text)) {
    const lw = word.toLowerCase();
    if (/[äöüß]/i.test(word)) de += 1;
    if (DE_MARKERS.has(lw)) de += 1;
    if (EN_MARKERS.has(lw)) en += 1;
  }
  if (!de && !en) return null;
  return de >= en ? 'de' : 'en';
}
