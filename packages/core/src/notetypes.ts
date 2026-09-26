import { clozeAnswers, clozeNumbers, clozeToPlain } from './cloze';
import { normalizeWordFields, parseGender, pluralDisplay, withArticle } from './german/articles';
import { plainText } from './text';
import type { Note, NoteType } from './types';

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  /** Content is German → speakable with TTS */
  german?: boolean;
  help?: string;
}

export interface NoteTypeDef {
  id: NoteType;
  name: string;
  short: string;
  description: string;
  fields: FieldDef[];
  templates: string[];
}

export const NOTE_TYPES: Record<NoteType, NoteTypeDef> = {
  word: {
    id: 'word',
    name: 'Wort · Vocabulary',
    short: 'Word',
    description: 'A German word with gender, plural, forms and an example sentence. Creates DE→EN and EN→DE cards.',
    fields: [
      { key: 'german', label: 'Deutsch', placeholder: 'Tisch  (or "der Tisch")', required: true, german: true },
      { key: 'english', label: 'Meaning', placeholder: 'table', required: true },
      { key: 'pos', label: 'Part of speech' },
      { key: 'gender', label: 'Gender' },
      { key: 'plural', label: 'Plural', placeholder: 'Tische', german: true },
      { key: 'forms', label: 'Forms', placeholder: 'fährt · fuhr · ist gefahren', german: true, help: 'Verbs: er-form · Präteritum · Perfekt. Adjectives: Komparativ · Superlativ.' },
      { key: 'example', label: 'Example', placeholder: 'Der Tisch ist aus Holz.', multiline: true, german: true },
      { key: 'exampleTranslation', label: 'Example translation', placeholder: 'The table is made of wood.', multiline: true },
      { key: 'notes', label: 'Notes', multiline: true },
    ],
    templates: ['Deutsch → Meaning', 'Meaning → Deutsch'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    short: 'Basic',
    description: 'Front and back. One card.',
    fields: [
      { key: 'front', label: 'Front', multiline: true, required: true, german: true },
      { key: 'back', label: 'Back', multiline: true, required: true },
    ],
    templates: ['Front → Back'],
  },
  reversed: {
    id: 'reversed',
    name: 'Basic + reversed',
    short: 'Reversed',
    description: 'Front and back, tested in both directions. Two cards.',
    fields: [
      { key: 'front', label: 'Front', multiline: true, required: true, german: true },
      { key: 'back', label: 'Back', multiline: true, required: true },
    ],
    templates: ['Front → Back', 'Back → Front'],
  },
  typing: {
    id: 'typing',
    name: 'Type the answer',
    short: 'Typing',
    description: 'You type the answer and get a letter-by-letter diff. Great for spelling and endings.',
    fields: [
      { key: 'front', label: 'Prompt', multiline: true, required: true },
      { key: 'back', label: 'Answer (typed)', required: true, german: true },
      { key: 'extra', label: 'Extra', multiline: true },
    ],
    templates: ['Type the answer'],
  },
  cloze: {
    id: 'cloze',
    name: 'Cloze · Lückentext',
    short: 'Cloze',
    description: 'Sentences with gaps: "Ich gehe {{c1::in die}} Stadt." One card per gap number.',
    fields: [
      { key: 'text', label: 'Text', multiline: true, required: true, german: true, placeholder: 'Ich fahre {{c1::mit dem}} Bus {{c2::zur}} Arbeit.', help: 'Wrap hidden parts in {{c1::…}}; add a hint with {{c1::answer::hint}}.' },
      { key: 'extra', label: 'Extra / translation', multiline: true },
    ],
    templates: ['Cloze'],
  },
};

export const NOTE_TYPE_ORDER: NoteType[] = ['word', 'basic', 'reversed', 'typing', 'cloze'];

export function isNoteType(t: unknown): t is NoteType {
  return typeof t === 'string' && t in NOTE_TYPES;
}

/** Card ordinals a note should have. */
export function noteOrds(note: Pick<Note, 'type' | 'fields'>): number[] {
  switch (note.type) {
    case 'basic':
    case 'typing':
      return [0];
    case 'reversed':
    case 'word':
      return [0, 1];
    case 'cloze':
      return clozeNumbers(note.fields.text ?? '').map((n) => n - 1);
  }
}

export function templateName(type: NoteType, ord: number): string {
  if (type === 'cloze') return `Cloze ${ord + 1}`;
  return NOTE_TYPES[type].templates[ord] ?? `Card ${ord + 1}`;
}

/** Normalise user/AI supplied fields for a note type (trims, splits articles, etc.). */
export function normalizeFields(type: NoteType, fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of NOTE_TYPES[type].fields) {
    const v = fields[f.key];
    out[f.key] = v === undefined || v === null ? '' : String(v).trim();
  }
  // Keep unknown keys too (imported notes), but stringify them.
  for (const [k, v] of Object.entries(fields)) if (!(k in out) && v != null) out[k] = String(v);
  return type === 'word' ? normalizeWordFields(out) : out;
}

export function validateNote(note: Pick<Note, 'type' | 'fields'>): string | null {
  const def = NOTE_TYPES[note.type];
  if (!def) return `Unknown note type "${note.type}"`;
  for (const f of def.fields) {
    if (f.required && !plainText(note.fields[f.key] ?? '').trim() && !(note.fields[f.key] ?? '').includes('<img')) {
      return `"${f.label}" is required`;
    }
  }
  if (note.type === 'cloze' && noteOrds(note).length === 0) {
    return 'Cloze text needs at least one deletion like {{c1::Wort}}';
  }
  return null;
}

/** Headword for lists: "der Tisch", "fahren", or the (plain) front text. */
export function noteTitle(note: Pick<Note, 'type' | 'fields'>): string {
  const f = note.fields;
  switch (note.type) {
    case 'word':
      return withArticle(plainText(f.german ?? ''), f.gender);
    case 'cloze':
      return plainText(clozeToPlain(f.text ?? ''));
    default:
      return plainText(f.front ?? '');
  }
}

export function noteSubtitle(note: Pick<Note, 'type' | 'fields'>): string {
  const f = note.fields;
  switch (note.type) {
    case 'word':
      return plainText(f.english ?? '');
    case 'cloze':
      return plainText(f.extra ?? '');
    default:
      return plainText(f.back ?? '');
  }
}

/** One-line summary used by the AI tools: "der Tisch (die Tische) — table". */
export function noteSummary(note: Pick<Note, 'type' | 'fields'>): string {
  const f = note.fields;
  if (note.type === 'word') {
    const pl = pluralDisplay(f.plural);
    const extra = [pl, f.forms].filter(Boolean).join('; ');
    return `${noteTitle(note)}${extra ? ` (${plainText(extra)})` : ''} — ${plainText(f.english ?? '')}`;
  }
  return `${noteTitle(note)} — ${noteSubtitle(note)}`;
}

/** Plain-text question/answer for a card (used by search, AI context and accessibility). */
export function cardQA(note: Pick<Note, 'type' | 'fields'>, ord: number): { question: string; answer: string } {
  const f = note.fields;
  switch (note.type) {
    case 'word': {
      const de = withArticle(plainText(f.german ?? ''), f.gender);
      const en = plainText(f.english ?? '');
      return ord === 0 ? { question: de, answer: en } : { question: en, answer: de };
    }
    case 'reversed':
      return ord === 0
        ? { question: plainText(f.front ?? ''), answer: plainText(f.back ?? '') }
        : { question: plainText(f.back ?? ''), answer: plainText(f.front ?? '') };
    case 'cloze': {
      const text = f.text ?? '';
      return { question: plainText(text), answer: clozeAnswers(text, ord + 1).map(plainText).join(', ') };
    }
    default:
      return { question: plainText(f.front ?? ''), answer: plainText(f.back ?? '') };
  }
}

/** The string the learner must type (typing cards, EN→DE word cards, cloze). */
export function expectedTypedAnswer(note: Pick<Note, 'type' | 'fields'>, ord: number): string {
  const f = note.fields;
  switch (note.type) {
    case 'word':
      return withArticle(plainText(f.german ?? ''), f.gender);
    case 'typing':
      return plainText(f.back ?? '');
    case 'cloze':
      return clozeAnswers(f.text ?? '', ord + 1).map(plainText).join(', ');
    case 'reversed':
      return plainText(ord === 0 ? f.back ?? '' : f.front ?? '');
    default:
      return plainText(f.back ?? '');
  }
}

/** Does this card ask the learner to *produce* German (so typing makes sense)? */
export function isProductionCard(note: Pick<Note, 'type'>, ord: number): boolean {
  return note.type === 'typing' || note.type === 'cloze' || (note.type === 'word' && ord === 1);
}

export function nounGender(note: Pick<Note, 'type' | 'fields'>) {
  return note.type === 'word' ? parseGender(note.fields.gender) : null;
}
