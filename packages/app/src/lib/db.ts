import Dexie, { type Table } from 'dexie';
import type { Card, Chat, Deck, Note, Prefs, ReviewLog, TableName } from '@anker/core';

export interface OutboxEntry {
  key: string;
  table: TableName;
  id: string;
  updatedAt: number;
}

export interface Tombstone {
  key: string;
  table: TableName;
  id: string;
  updatedAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Local-only stats for the practice games (not synced). */
export interface DrillStat {
  key: string;
  game: string;
  item: string;
  right: number;
  wrong: number;
  lastAt: number;
}

export class AnkerDB extends Dexie {
  decks!: Table<Deck, string>;
  notes!: Table<Note, string>;
  cards!: Table<Card, string>;
  revlog!: Table<ReviewLog, string>;
  chats!: Table<Chat, string>;
  prefs!: Table<Prefs, string>;
  outbox!: Table<OutboxEntry, string>;
  tombstones!: Table<Tombstone, string>;
  meta!: Table<MetaEntry, string>;
  drillStats!: Table<DrillStat, string>;

  constructor() {
    super('anker');
    this.version(1).stores({
      decks: 'id, parentId',
      notes: 'id, deckId, type, createdAt, *tags',
      cards: 'id, noteId, deckId, due, state, suspended',
      revlog: 'id, cardId, noteId, deckId, review',
      chats: 'id, updatedAt',
      prefs: 'id',
      outbox: 'key, table',
      tombstones: 'key, table',
      meta: 'key',
      drillStats: 'key, game, lastAt',
    });
  }
}

export const db = new AnkerDB();

export const TABLES = {
  decks: () => db.decks,
  notes: () => db.notes,
  cards: () => db.cards,
  revlog: () => db.revlog,
  chats: () => db.chats,
  prefs: () => db.prefs,
} satisfies Record<TableName, () => Table<any, string>>;

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const e = await db.meta.get(key);
  return e === undefined ? fallback : (e.value as T);
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
