import { slugify } from '../ids';
import type { Gender, NoteType } from '../types';
import { NOUNS_A1, VERBS_A1, WORDS_A1 } from './grundwortschatz';
import { CLOZE_CASES, PHRASES, STRONG_VERBS } from './more';

export interface StarterNote {
  id: string;
  type: NoteType;
  fields: Record<string, string>;
  tags: string[];
}

export interface StarterDeck {
  key: string;
  path: string;
  emoji: string;
  title: string;
  description: string;
  level: string;
  count: number;
  notes: () => StarterNote[];
}

const a1Verbs = new Set(VERBS_A1.map((v) => v[0]));

function a1Notes(): StarterNote[] {
  const nouns = NOUNS_A1.map(([gender, german, plural, english, example, exampleTranslation, notes]) => ({
    id: `st-a1-n-${slugify(german)}`,
    type: 'word' as const,
    fields: { german, gender, plural: plural === '-' ? '-' : plural, english, pos: 'noun', example, exampleTranslation, notes: notes ?? '', forms: '' },
    tags: ['A1', 'nomen', 'starter'],
  }));
  const verbs = VERBS_A1.map(([german, english, forms, example, exampleTranslation, notes]) => ({
    id: `st-a1-v-${slugify(german)}`,
    type: 'word' as const,
    fields: { german, english, pos: 'verb', forms, example, exampleTranslation, notes: notes ?? '', gender: '', plural: '' },
    tags: ['A1', 'verb', 'starter'],
  }));
  const words = WORDS_A1.map(([german, english, pos, forms, example, exampleTranslation, notes]) => ({
    id: `st-a1-${pos.slice(0, 4)}-${slugify(german)}`,
    type: 'word' as const,
    fields: { german, english, pos, forms, example, exampleTranslation, notes: notes ?? '', gender: '', plural: '' },
    tags: ['A1', pos === 'adjective' ? 'adjektiv' : pos === 'adverb' ? 'adverb' : pos, 'starter'],
  }));
  return [...nouns, ...verbs, ...words];
}

function strongVerbNotes(): StarterNote[] {
  return STRONG_VERBS.filter((v) => !a1Verbs.has(v[0])).map(([german, english, forms, example, exampleTranslation, notes]) => ({
    id: `st-verb-${slugify(german)}`,
    type: 'word' as const,
    fields: { german, english, pos: 'verb', forms, example, exampleTranslation, notes: notes ?? '', gender: '', plural: '' },
    tags: ['verb', 'stark', 'starter'],
  }));
}

function clozeNotes(): StarterNote[] {
  return CLOZE_CASES.map(([text, extra], i) => ({
    id: `st-case-${String(i + 1).padStart(2, '0')}`,
    type: 'cloze' as const,
    fields: { text, extra },
    tags: ['grammatik', 'starter'],
  }));
}

function phraseNotes(): StarterNote[] {
  return PHRASES.map(([front, back, note]) => ({
    id: `st-phrase-${slugify(front).slice(0, 40)}`,
    type: 'reversed' as const,
    fields: { front, back: note ? `${back}<br><small>${note}</small>` : back },
    tags: ['redemittel', 'starter'],
  }));
}

export const STARTER_DECKS: StarterDeck[] = [
  {
    key: 'a1',
    path: 'Deutsch::Grundwortschatz',
    emoji: '🧱',
    title: 'Grundwortschatz A1–A2',
    description: 'The essential words: nouns with article & plural, verbs with forms, adjectives and little words — each with an example.',
    level: 'A1–A2',
    count: NOUNS_A1.length + VERBS_A1.length + WORDS_A1.length,
    notes: a1Notes,
  },
  {
    key: 'verben',
    path: 'Deutsch::Starke Verben',
    emoji: '💪',
    title: 'Starke & unregelmäßige Verben',
    description: 'fahren · fuhr · ist gefahren — the verbs whose past forms you simply have to know.',
    level: 'A2–B1',
    count: STRONG_VERBS.filter((v) => !a1Verbs.has(v[0])).length,
    notes: strongVerbNotes,
  },
  {
    key: 'faelle',
    path: 'Deutsch::Grammatik',
    emoji: '🧩',
    title: 'Fälle, Präpositionen & Satzbau',
    description: 'Cloze sentences that drill dem/den/der, Wo?/Wohin?, contractions and verb position.',
    level: 'A1–B1',
    count: CLOZE_CASES.length,
    notes: clozeNotes,
  },
  {
    key: 'redemittel',
    path: 'Deutsch::Redemittel',
    emoji: '💬',
    title: 'Redemittel & Redewendungen',
    description: 'Everyday phrases and a few beloved idioms (Ich verstehe nur Bahnhof!).',
    level: 'A1–B1',
    count: PHRASES.length,
    notes: phraseNotes,
  },
];

/** Deterministic deck ids so installing on two devices never duplicates decks. */
export function starterDeckId(path: string): string {
  return `st-deck-${slugify(path.replace(/::/g, '-'))}`;
}

export interface PoolNoun {
  word: string;
  gender: Gender;
  plural: string;
  meaning: string;
}

/** Built-in nouns for the practice games (merged with the learner's own nouns). */
export function builtinNouns(): PoolNoun[] {
  return NOUNS_A1.map(([g, word, plural, meaning]) => ({ word, gender: g as Gender, plural, meaning }));
}

export interface PoolVerb {
  infinitive: string;
  meaning: string;
  forms: string;
}

export function builtinVerbs(): PoolVerb[] {
  const seen = new Set<string>();
  const out: PoolVerb[] = [];
  for (const [infinitive, meaning, forms] of [...VERBS_A1, ...STRONG_VERBS]) {
    if (seen.has(infinitive)) continue;
    seen.add(infinitive);
    out.push({ infinitive, meaning, forms });
  }
  return out;
}

export function builtinSentences(): { de: string; en: string }[] {
  return [...NOUNS_A1, ...VERBS_A1.map((v) => ['', '', '', '', v[3], v[4]] as const)]
    .map((r) => ({ de: r[4] as string, en: r[5] as string }))
    .filter((s) => s.de && s.de.split(' ').length <= 9);
}
