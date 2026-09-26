// Pure record-building helpers shared by the app (IndexedDB) and the hub (MCP / API).
import { DECK_SEP, normalizePath } from './decks';
import { cardIdFor, newId } from './ids';
import { normalizeFields, noteOrds, validateNote } from './notetypes';
import { newCard } from './scheduler';
import { normalizeForSearch, plainText } from './text';
import type { Card, Deck, Note, NoteSource, NoteType } from './types';

export function makeDeck(input: {
  name: string;
  parentId?: string | null;
  description?: string;
  emoji?: string;
  config?: Deck['config'];
  now: number;
  id?: string;
}): Deck {
  return {
    id: input.id ?? newId(),
    name: input.name.trim().replace(/::/g, ':') || 'Untitled',
    parentId: input.parentId ?? null,
    description: input.description,
    emoji: input.emoji,
    config: input.config,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Resolve "A::B::C" against existing decks; returns the leaf plus any decks
 * that must be created (in parent→child order).
 */
export function planDeckPath(path: string, decks: Deck[], now: number): { deck: Deck; created: Deck[] } {
  const parts = normalizePath(path).split(DECK_SEP).filter(Boolean);
  if (!parts.length) throw new Error('Deck path is empty');
  const created: Deck[] = [];
  let parentId: string | null = null;
  let current: Deck | undefined;
  const all = [...decks];
  for (const part of parts) {
    current = all.find(
      (d) => d.parentId === parentId && d.name.toLowerCase() === part.toLowerCase(),
    );
    if (!current) {
      current = makeDeck({ name: part, parentId, now });
      created.push(current);
      all.push(current);
    }
    parentId = current.id;
  }
  return { deck: current!, created };
}

export interface NoteInput {
  deckId: string;
  type: NoteType;
  fields: Record<string, unknown>;
  tags?: string[];
  source?: NoteSource;
  id?: string;
}

export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return typeof tags === 'string' ? cleanTags(tags.split(/[\s,]+/)) : [];
  const out = new Set<string>();
  for (const t of tags) {
    const s = String(t).trim().replace(/\s+/g, '_');
    if (s) out.add(s);
  }
  return [...out];
}

/** Build a note and its cards. Throws with a readable message if invalid. */
export function makeNote(input: NoteInput, now: number, position = now): { note: Note; cards: Card[] } {
  const fields = normalizeFields(input.type, input.fields);
  const note: Note = {
    id: input.id ?? newId(),
    deckId: input.deckId,
    type: input.type,
    fields,
    tags: cleanTags(input.tags),
    source: input.source ?? 'user',
    createdAt: now,
    updatedAt: now,
  };
  const err = validateNote(note);
  if (err) throw new Error(err);
  const cards = noteOrds(note).map((ord) => newCard({ noteId: note.id, deckId: note.deckId, ord, now, position }));
  return { note, cards };
}

/** After a note edit: which cards to create / delete / move so they match the note. */
export function reconcileCards(note: Note, existing: Card[], now: number) {
  const want = new Set(noteOrds(note));
  const have = new Map(existing.map((c) => [c.ord, c]));
  const create: Card[] = [];
  const remove: Card[] = [];
  const update: Card[] = [];
  for (const ord of want) {
    if (!have.has(ord)) {
      create.push(newCard({ noteId: note.id, deckId: note.deckId, ord, now, position: now }));
    }
  }
  for (const c of existing) {
    if (!want.has(c.ord)) remove.push(c);
    else if (c.deckId !== note.deckId) update.push({ ...c, deckId: note.deckId, updatedAt: now });
  }
  return { create, remove, update };
}

/** Apply a partial field/tag/deck patch to a note (fields are merged). */
export function patchNote(
  note: Note,
  patch: { fields?: Record<string, unknown>; tags?: string[]; deckId?: string; type?: NoteType },
  now: number,
): Note {
  const type = patch.type ?? note.type;
  const merged = { ...note.fields, ...(patch.fields ?? {}) };
  const next: Note = {
    ...note,
    type,
    deckId: patch.deckId ?? note.deckId,
    fields: normalizeFields(type, merged),
    tags: patch.tags ? cleanTags(patch.tags) : note.tags,
    updatedAt: now,
  };
  const err = validateNote(next);
  if (err) throw new Error(err);
  return next;
}

/** Key used to detect duplicate notes ("der Tisch" and "Tisch" collide). */
export function duplicateKey(note: Pick<Note, 'type' | 'fields'>): string {
  const f = note.fields;
  const main = note.type === 'word' ? f.german : note.type === 'cloze' ? f.text : f.front;
  return normalizeForSearch(plainText(main ?? '').replace(/^(der|die|das)\s+/i, ''));
}

export { cardIdFor };
