// All local writes go through `commit`, which records every change in the
// outbox so the sync engine can push it to the hub.
import {
  answerCard,
  cleanTags,
  forgetCard,
  makeDeck,
  makeNote,
  nextDayStartMs,
  patchNote,
  planDeckPath,
  reconcileCards,
  resolveDeckConfig,
  subtreeIds,
  withPrefDefaults,
  type AnyRecord,
  type Card,
  type Deck,
  type DeckConfig,
  type Note,
  type NoteInput,
  type NoteType,
  type Prefs,
  type Rating,
  type ReviewLog,
  type TableName,
} from '@anker/core';
import { db, tableOf, TABLES } from './db';
import { tr } from './i18n';

type Op = { table: TableName; put?: AnyRecord[]; remove?: string[] };

let afterCommit: (() => void) | null = null;
export function onCommit(fn: () => void) {
  afterCommit = fn;
}

export async function commit(ops: Op[]) {
  const tables = [...new Set(ops.map((o) => o.table))].map((t) => TABLES[t]());
  await db.transaction('rw', [...tables, db.outbox, db.tombstones], async () => {
    for (const op of ops) {
      const table = tableOf(op.table);
      if (op.put?.length) {
        await table.bulkPut(op.put);
        await db.outbox.bulkPut(op.put.map((r) => ({ key: `${op.table}:${r.id}`, table: op.table, id: r.id, updatedAt: r.updatedAt })));
        await db.tombstones.bulkDelete(op.put.map((r) => `${op.table}:${r.id}`));
      }
      if (op.remove?.length) {
        const now = Date.now();
        await table.bulkDelete(op.remove);
        const entries = op.remove.map((id) => ({ key: `${op.table}:${id}`, table: op.table, id, updatedAt: now }));
        await db.tombstones.bulkPut(entries);
        await db.outbox.bulkPut(entries);
      }
    }
  });
  afterCommit?.();
}

const stamp = <T extends AnyRecord>(r: T, now = Date.now()): T => ({ ...r, updatedAt: Math.max(now, (r.updatedAt ?? 0) + 1) });

// ---------------------------------------------------------------- prefs
export async function getPrefs(): Promise<Prefs> {
  return withPrefDefaults(await db.prefs.get('global'));
}

export async function savePrefs(patch: Partial<Prefs>) {
  const cur = await getPrefs();
  await commit([{ table: 'prefs', put: [stamp({ ...cur, ...patch, id: 'global' })] }]);
}

// ---------------------------------------------------------------- decks
export async function createDeckPath(path: string, meta: Partial<Pick<Deck, 'description' | 'emoji' | 'config'>> = {}): Promise<Deck> {
  const decks = await db.decks.toArray();
  const { deck, created } = planDeckPath(path, decks, Date.now());
  if (created.length) {
    const withMeta = created.map((d) => (d.id === deck.id ? { ...d, ...meta } : d));
    await commit([{ table: 'decks', put: withMeta }]);
    return withMeta.find((d) => d.id === deck.id)!;
  }
  return deck;
}

export async function createDeck(name: string, parentId: string | null, meta: Partial<Deck> = {}): Promise<Deck> {
  const d = { ...makeDeck({ name, parentId, now: Date.now() }), ...meta };
  await commit([{ table: 'decks', put: [d] }]);
  return d;
}

export async function updateDeck(id: string, patch: Partial<Omit<Deck, 'id'>>) {
  const d = await db.decks.get(id);
  if (!d) return;
  if (patch.parentId) {
    const all = await db.decks.toArray();
    if (subtreeIds(id, all).has(patch.parentId)) throw new Error(tr('Ein Deck kann nicht in sich selbst verschoben werden.'));
  }
  await commit([{ table: 'decks', put: [stamp({ ...d, ...patch })] }]);
}

export async function updateDeckConfig(id: string, patch: Partial<DeckConfig>) {
  const d = await db.decks.get(id);
  if (!d) return;
  await commit([{ table: 'decks', put: [stamp({ ...d, config: { ...(d.config ?? {}), ...patch } })] }]);
}

export async function deleteDeck(id: string) {
  const all = await db.decks.toArray();
  const ids = [...subtreeIds(id, all)];
  const notes = await db.notes.where('deckId').anyOf(ids).primaryKeys();
  const cards = await db.cards.where('noteId').anyOf(notes).primaryKeys();
  await commit([
    { table: 'cards', remove: cards },
    { table: 'notes', remove: notes },
    { table: 'decks', remove: ids },
  ]);
  return { decks: ids.length, notes: notes.length };
}

export async function deckConfig(deckId: string): Promise<DeckConfig> {
  const all = await db.decks.toArray();
  const byId = new Map(all.map((d) => [d.id, d]));
  return resolveDeckConfig(byId.get(deckId), byId);
}

// ---------------------------------------------------------------- notes
export async function addNote(input: NoteInput): Promise<{ note: Note; cards: Card[] }> {
  const now = Date.now();
  const r = makeNote(input, now);
  await commit([
    { table: 'notes', put: [r.note] },
    { table: 'cards', put: r.cards },
  ]);
  return r;
}

export async function addNotes(inputs: NoteInput[]): Promise<{ added: number; errors: string[] }> {
  const now = Date.now();
  const notes: Note[] = [];
  const cards: Card[] = [];
  const errors: string[] = [];
  inputs.forEach((input, i) => {
    try {
      const r = makeNote(input, now, now + i);
      notes.push(r.note);
      cards.push(...r.cards);
    } catch (e) {
      errors.push(`#${i + 1}: ${(e as Error).message}`);
    }
  });
  for (let i = 0; i < notes.length; i += 500) {
    const ns = notes.slice(i, i + 500);
    const ids = new Set(ns.map((n) => n.id));
    await commit([
      { table: 'notes', put: ns },
      { table: 'cards', put: cards.filter((c) => ids.has(c.noteId)) },
    ]);
  }
  return { added: notes.length, errors };
}

export async function updateNote(
  id: string,
  patch: { fields?: Record<string, unknown>; tags?: string[]; deckId?: string; type?: NoteType },
): Promise<Note> {
  const note = await db.notes.get(id);
  if (!note) throw new Error(tr('Notiz nicht gefunden'));
  const now = Date.now();
  const next = patchNote(note, { ...patch, tags: patch.tags ? cleanTags(patch.tags) : undefined }, now);
  const existing = await db.cards.where('noteId').equals(id).toArray();
  const rec = reconcileCards(next, existing, now);
  await commit([
    { table: 'notes', put: [stamp(next, now)] },
    { table: 'cards', put: [...rec.create, ...rec.update], remove: rec.remove.map((c) => c.id) },
  ]);
  return next;
}

export async function deleteNotes(ids: string[]) {
  const cards = await db.cards.where('noteId').anyOf(ids).primaryKeys();
  await commit([
    { table: 'cards', remove: cards },
    { table: 'notes', remove: ids },
  ]);
}

export async function moveNotes(ids: string[], deckId: string) {
  const notes = await db.notes.bulkGet(ids);
  const now = Date.now();
  const nextNotes = notes.filter(Boolean).map((n) => stamp({ ...n!, deckId }, now));
  const cards = (await db.cards.where('noteId').anyOf(ids).toArray()).map((c) => stamp({ ...c, deckId }, now));
  await commit([
    { table: 'notes', put: nextNotes },
    { table: 'cards', put: cards },
  ]);
}

export async function tagNotes(ids: string[], add: string[], remove: string[] = []) {
  const notes = (await db.notes.bulkGet(ids)).filter(Boolean) as Note[];
  const rm = new Set(remove.map((t) => t.toLowerCase()));
  const now = Date.now();
  await commit([
    {
      table: 'notes',
      put: notes.map((n) => stamp({ ...n, tags: cleanTags([...n.tags.filter((t) => !rm.has(t.toLowerCase())), ...add]) }, now)),
    },
  ]);
}

// ---------------------------------------------------------------- cards
export async function setCardsSuspended(cardIds: string[], suspended: boolean) {
  const cards = (await db.cards.bulkGet(cardIds)).filter(Boolean) as Card[];
  await commit([{ table: 'cards', put: cards.map((c) => stamp({ ...c, suspended: suspended ? 1 : 0 })) }]);
}

export async function suspendNotes(noteIds: string[], suspended: boolean) {
  const cards = await db.cards.where('noteId').anyOf(noteIds).toArray();
  await commit([{ table: 'cards', put: cards.map((c) => stamp({ ...c, suspended: suspended ? 1 : 0 })) }]);
}

export async function buryCards(cardIds: string[]) {
  const prefs = await getPrefs();
  const until = nextDayStartMs(Date.now(), prefs.rolloverHour);
  const cards = (await db.cards.bulkGet(cardIds)).filter(Boolean) as Card[];
  await commit([{ table: 'cards', put: cards.map((c) => stamp({ ...c, buriedUntil: until })) }]);
}

export async function setFlag(cardId: string, flag: number) {
  const c = await db.cards.get(cardId);
  if (c) await commit([{ table: 'cards', put: [stamp({ ...c, flag })] }]);
}

export async function forgetNotes(noteIds: string[]) {
  const now = Date.now();
  const cards = await db.cards.where('noteId').anyOf(noteIds).toArray();
  await commit([{ table: 'cards', put: cards.map((c) => forgetCard(c, now)) }]);
}

/** Answer a card: new scheduling state + a review log entry. Returns data for undo. */
export async function recordAnswer(card: Card, rating: Rating, durationMs: number) {
  const cfg = await deckConfig(card.deckId);
  const now = Date.now();
  const { card: next, log } = answerCard(card, rating, cfg, now, durationMs);
  await commit([
    { table: 'cards', put: [next] },
    { table: 'revlog', put: [log] },
  ]);
  return { next, log, prev: card };
}

export async function undoAnswer(prev: Card, log: ReviewLog) {
  await commit([
    { table: 'cards', put: [stamp(prev)] },
    { table: 'revlog', remove: [log.id] },
  ]);
}

// ---------------------------------------------------------------- chats
export async function deleteChat(id: string) {
  await commit([{ table: 'chats', remove: [id] }]);
}
