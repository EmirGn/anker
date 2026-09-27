// Anki .apkg / .colpkg import: notes, decks, images and (optionally) review
// history, replayed through FSRS so cards keep their progress.
import {
  answerCard,
  DEFAULT_DECK_CONFIG,
  makeNote,
  newId,
  planDeckPath,
  type Card,
  type Deck,
  type Note,
  type Rating,
  type ReviewLog,
} from '@anker/core';
import { decompress } from 'fzstd';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { db } from './db';
import { commit } from './repo';

export interface AnkiNote {
  ankiId: number;
  type: 'basic' | 'cloze';
  fields: Record<string, string>;
  tags: string[];
  deck: string;
}

export interface AnkiPackage {
  format: string;
  notes: AnkiNote[];
  decks: string[];
  cards: { id: number; nid: number; ord: number; suspended: boolean }[];
  revlog: { time: number; cid: number; ease: number; type: number; ms: number }[];
  images: number;
}

// ---- tiny protobuf reader (for the anki21b media index) -----------------------
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let b: number;
  do {
    b = buf[pos++]!;
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

function* protoFields(buf: Uint8Array): Generator<{ field: number; wire: number; value: number | Uint8Array }> {
  let pos = 0;
  while (pos < buf.length) {
    let key: number;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let v: number;
      [v, pos] = readVarint(buf, pos);
      yield { field, wire, value: v };
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      yield { field, wire, value: buf.subarray(pos, pos + len) };
      pos += len;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 1) {
      pos += 8;
    } else break;
  }
}

function mediaIndexFromProto(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  let i = 0;
  for (const f of protoFields(bytes)) {
    if (f.field !== 1 || !(f.value instanceof Uint8Array)) continue;
    let name = '';
    let legacy: number | null = null;
    for (const e of protoFields(f.value)) {
      if (e.field === 1 && e.value instanceof Uint8Array) name = dec.decode(e.value);
      if (e.field === 255 && typeof e.value === 'number') legacy = e.value;
    }
    out.set(name, String(legacy ?? i));
    i++;
  }
  return out;
}

const isZstd = (b: Uint8Array) => b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

function mimeOf(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function parseAnkiPackage(file: File, onStatus: (s: string) => void): Promise<AnkiPackage> {
  onStatus('Paket wird geöffnet …');
  const zip = await JSZip.loadAsync(file);
  let bytes: Uint8Array;
  let format: string;
  const f21b = zip.file('collection.anki21b');
  const f21 = zip.file('collection.anki21');
  const f2 = zip.file('collection.anki2');
  if (f21b) {
    bytes = decompress(await f21b.async('uint8array'));
    format = 'Anki 2.1.50+';
  } else if (f21) {
    bytes = await f21.async('uint8array');
    format = 'Anki 2.1';
  } else if (f2) {
    bytes = await f2.async('uint8array');
    format = 'Anki 2.0';
  } else throw new Error('Das ist kein Anki-Paket (.apkg / .colpkg).');

  onStatus('Sammlung wird gelesen …');
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const sdb = new SQL.Database(bytes);
  const rows = (sql: string): unknown[][] => {
    try {
      return sdb.exec(sql)[0]?.values ?? [];
    } catch {
      return [];
    }
  };

  // Note types (cloze detection) and deck names — legacy JSON or new tables.
  const clozeModels = new Set<number>();
  const deckNames = new Map<number, string>();
  const col = rows('SELECT models, decks FROM col')[0];
  if (col) {
    try {
      const models = JSON.parse(String(col[0] || '{}')) as Record<string, { type: number }>;
      for (const [id, m] of Object.entries(models)) if (m.type === 1) clozeModels.add(Number(id));
    } catch {
      // new schema keeps these elsewhere
    }
    try {
      const decks = JSON.parse(String(col[1] || '{}')) as Record<string, { name: string }>;
      for (const [id, d] of Object.entries(decks)) deckNames.set(Number(id), d.name);
    } catch {
      // ignore
    }
  }
  for (const [id, name] of rows('SELECT id, name FROM decks')) deckNames.set(Number(id), String(name).replace(/\x1f/g, '::'));
  for (const [id, name] of rows('SELECT id, name FROM notetypes')) if (/cloze|lückentext/i.test(String(name))) clozeModels.add(Number(id));

  // Media
  onStatus('Medien werden gelesen …');
  let media = new Map<string, string>();
  const mediaFile = zip.file('media');
  if (mediaFile) {
    const raw = await mediaFile.async('uint8array');
    try {
      const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>;
      media = new Map(Object.entries(json).map(([k, v]) => [v, k]));
    } catch {
      try {
        media = mediaIndexFromProto(isZstd(raw) ? decompress(raw) : raw);
      } catch {
        media = new Map();
      }
    }
  }
  const imageCache = new Map<string, string | null>();
  let images = 0;
  let budget = 40 * 1024 * 1024;
  const imageData = async (name: string): Promise<string | null> => {
    if (imageCache.has(name)) return imageCache.get(name)!;
    const zipName = media.get(name);
    const mime = mimeOf(name);
    let url: string | null = null;
    if (zipName && mime) {
      const f = zip.file(zipName);
      if (f) {
        let data = await f.async('uint8array');
        if (isZstd(data)) data = decompress(data);
        if (data.length < 400 * 1024 && budget > data.length) {
          budget -= data.length;
          url = `data:${mime};base64,${toBase64(data)}`;
          images++;
        }
      }
    }
    imageCache.set(name, url);
    return url;
  };

  const cleanField = async (html: string): Promise<string> => {
    let out = html.replace(/\[sound:[^\]]+\]/g, '');
    const imgs = [...out.matchAll(/<img[^>]*src=["']?([^"'\s>]+)["']?[^>]*>/gi)];
    for (const m of imgs) {
      const name = decodeURIComponent(m[1]!);
      const url = /^(https?:|data:)/.test(name) ? name : await imageData(name);
      out = out.replace(m[0], url ? `<img src="${url}">` : '');
    }
    return out.trim();
  };

  onStatus('Notizen werden umgewandelt …');
  const cards = rows('SELECT id, nid, did, ord, queue FROM cards').map(([id, nid, did, ord, queue]) => ({
    id: Number(id),
    nid: Number(nid),
    did: Number(did),
    ord: Number(ord),
    suspended: Number(queue) === -1,
  }));
  const deckOfNote = new Map<number, number>();
  for (const c of cards) if (!deckOfNote.has(c.nid)) deckOfNote.set(c.nid, c.did);

  const notes: AnkiNote[] = [];
  for (const [id, mid, flds, tags] of rows('SELECT id, mid, flds, tags FROM notes')) {
    const parts = String(flds).split('\x1f');
    const cleaned = await Promise.all(parts.map(cleanField));
    const first = cleaned[0] ?? '';
    const rest = cleaned.slice(1).filter(Boolean).join('<br>');
    const cloze = clozeModels.has(Number(mid)) || /\{\{c\d+::/.test(first);
    if (!first && !rest) continue;
    notes.push({
      ankiId: Number(id),
      type: cloze ? 'cloze' : 'basic',
      fields: cloze ? { text: first, extra: rest } : { front: first, back: rest || '—' },
      tags: String(tags).trim().split(/\s+/).filter(Boolean),
      deck: deckNames.get(deckOfNote.get(Number(id)) ?? -1) ?? 'Imported',
    });
  }
  const revlog = rows('SELECT id, cid, ease, type, time FROM revlog ORDER BY id').map(([t, cid, ease, type, ms]) => ({
    time: Number(t),
    cid: Number(cid),
    ease: Number(ease),
    type: Number(type),
    ms: Number(ms),
  }));
  sdb.close();
  const decks = [...new Set(notes.map((n) => n.deck))].sort();
  return { format, notes, decks, cards, revlog, images };
}

/** Write the package into Anker. Returns counts. */
export async function importAnkiPackage(
  pkg: AnkiPackage,
  opts: { prefix: string; keepHistory: boolean },
  onStatus: (s: string) => void,
): Promise<{ notes: number; cards: number; reviews: number }> {
  const now = Date.now();
  const decks: Deck[] = await db.decks.toArray();
  const newDecks: Deck[] = [];
  const deckIdFor = new Map<string, string>();
  for (const name of pkg.decks) {
    const path = opts.prefix.trim() ? `${opts.prefix.trim()}::${name}` : name === 'Default' ? 'Anki' : name;
    const { deck, created } = planDeckPath(path, [...decks, ...newDecks], now);
    newDecks.push(...created);
    deckIdFor.set(name, deck.id);
  }

  onStatus('Notizen werden angelegt …');
  const notes: Note[] = [];
  const cardsById = new Map<string, Card>();
  const noteIdForAnki = new Map<number, string>();
  pkg.notes.forEach((n, i) => {
    try {
      const r = makeNote({ deckId: deckIdFor.get(n.deck)!, type: n.type, fields: n.fields, tags: n.tags, source: 'import', id: newId() }, now, now + i);
      notes.push(r.note);
      r.cards.forEach((c) => cardsById.set(c.id, c));
      noteIdForAnki.set(n.ankiId, r.note.id);
    } catch {
      // skip notes that don't fit a type (e.g. empty cloze)
    }
  });

  const logs: ReviewLog[] = [];
  const ankiCardToOurs = new Map<number, string>();
  for (const c of pkg.cards) {
    const noteId = noteIdForAnki.get(c.nid);
    if (!noteId) continue;
    const id = `${noteId}.${c.ord}`;
    const card = cardsById.get(id);
    if (!card) continue;
    ankiCardToOurs.set(c.id, id);
    if (c.suspended) cardsById.set(id, { ...card, suspended: 1 });
  }

  if (opts.keepHistory && pkg.revlog.length) {
    onStatus(`${pkg.revlog.length} Wiederholungen werden mit FSRS nachgerechnet …`);
    const byCard = new Map<number, typeof pkg.revlog>();
    for (const r of pkg.revlog) {
      if (r.ease < 1 || r.ease > 4 || r.type > 2) continue;
      const l = byCard.get(r.cid) ?? [];
      l.push(r);
      byCard.set(r.cid, l);
    }
    for (const [cid, list] of byCard) {
      const ourId = ankiCardToOurs.get(cid);
      if (!ourId) continue;
      let card = cardsById.get(ourId)!;
      const suspended = card.suspended;
      for (const r of list) {
        const { card: next, log } = answerCard(card, r.ease as Rating, DEFAULT_DECK_CONFIG, r.time, r.ms);
        logs.push(log);
        card = next;
      }
      cardsById.set(ourId, { ...card, suspended, updatedAt: now });
    }
  }

  onStatus('Wird gespeichert …');
  if (newDecks.length) await commit([{ table: 'decks', put: newDecks }]);
  const allCards = [...cardsById.values()];
  for (let i = 0; i < notes.length; i += 400) {
    const chunk = notes.slice(i, i + 400);
    const ids = new Set(chunk.map((n) => n.id));
    await commit([
      { table: 'notes', put: chunk },
      { table: 'cards', put: allCards.filter((c) => ids.has(c.noteId)) },
    ]);
  }
  for (let i = 0; i < logs.length; i += 2000) await commit([{ table: 'revlog', put: logs.slice(i, i + 2000) }]);
  return { notes: notes.length, cards: allCards.length, reviews: logs.length };
}
