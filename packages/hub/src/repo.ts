import {
  allDeckCounts,
  buildDeckTree,
  cardBreakdown,
  CardState,
  dayKey,
  dayStartMs,
  deckPath,
  duplicateKey,
  findDeckByPath,
  flattenTree,
  forecast,
  forgetCard,
  knownNoteCount,
  makeDeck,
  makeNote,
  matchesQuery,
  nextDayStartMs,
  noteSummary,
  parseQuery,
  patchNote,
  planDeckPath,
  reconcileCards,
  resolveDeckConfig,
  retention,
  reviewsByDay,
  streak,
  subtreeIds,
  summarizeLogs,
  withPrefDefaults,
  DAY,
  type Card,
  type Deck,
  type DeckConfig,
  type Note,
  type NoteInput,
  type Prefs,
  type ReviewLog,
} from '@anker/core';
import type { Store } from './store';

const STATE_NAME: Record<CardState, string> = {
  [CardState.New]: 'new',
  [CardState.Learning]: 'learning',
  [CardState.Review]: 'review',
  [CardState.Relearning]: 'relearning',
};

export interface NoteUpdate {
  id: string;
  fields?: Record<string, unknown>;
  tags?: string[];
  addTags?: string[];
  removeTags?: string[];
  deck?: string;
}

export class Repo {
  constructor(readonly store: Store) {}

  decks(): Deck[] {
    return this.store.all('decks');
  }

  deckMap(): Map<string, Deck> {
    return new Map(this.decks().map((d) => [d.id, d]));
  }

  prefs(): Prefs {
    return withPrefDefaults(this.store.get('prefs', 'global'));
  }

  /** One-time preference upgrades, applied once per install. */
  upgradePrefs() {
    const p = this.prefs();
    if ((p.schema ?? 0) >= 1) return;
    // 0.4: Otto runs on Claude Sonnet (the newest one Claude Code has) for everything.
    this.store.put('prefs', [{ ...p, schema: 1, defaultProvider: 'claude', claudeModel: 'sonnet' }]);
  }

  /** Otto's memory: one lasting fact about the learner per line. */
  remember(fact: string) {
    const p = this.prefs();
    const clean = fact.replace(/\s+/g, ' ').trim().replace(/^[-•]\s*/, '');
    if (!clean) throw new Error('fact is empty');
    const lines = (p.ottoNotes ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.some((l) => l.replace(/^[-•]\s*/, '').toLowerCase() === clean.toLowerCase())) return { saved: false, reason: 'Already remembered.' };
    const next = [...lines, `- ${clean}`].slice(-40);
    this.store.put('prefs', [{ ...p, ottoNotes: next.join('\n') }]);
    return { saved: true, facts: next.length };
  }

  pathOf(deckId: string, byId = this.deckMap()): string {
    const d = byId.get(deckId);
    return d ? deckPath(d, byId) : '(missing deck)';
  }

  /** Resolve a deck by id, full path or unique leaf name; optionally create the path. */
  resolveDeck(ref: string, opts: { create?: boolean } = {}): Deck {
    const decks = this.decks();
    const trimmed = (ref ?? '').trim();
    if (!trimmed) throw new Error('Deck is required (id or path like "Deutsch::Verben").');
    const byId = decks.find((d) => d.id === trimmed);
    if (byId) return byId;
    const byPath = findDeckByPath(trimmed, decks);
    if (byPath) return byPath;
    if (!trimmed.includes('::')) {
      const leaf = decks.filter((d) => d.name.toLowerCase() === trimmed.toLowerCase());
      if (leaf.length === 1) return leaf[0]!;
    }
    if (!opts.create) throw new Error(`Deck not found: "${ref}". Call list_decks to see existing decks, or create it with create_deck.`);
    const { deck, created } = planDeckPath(trimmed, decks, Date.now());
    if (created.length) this.store.put('decks', created);
    return deck;
  }

  createDeck(path: string, meta: { description?: string; emoji?: string; config?: Deck['config'] } = {}) {
    const decks = this.decks();
    const existing = findDeckByPath(path, decks);
    if (existing) return { deck: existing, created: false };
    const { deck, created } = planDeckPath(path, decks, Date.now());
    const leaf = { ...deck, ...stripUndefined(meta) };
    this.store.put('decks', created.map((d) => (d.id === leaf.id ? leaf : d)));
    return { deck: leaf, created: true };
  }

  updateDeck(
    ref: string,
    patch: { rename?: string; parent?: string | null; description?: string; emoji?: string; config?: Partial<DeckConfig> },
  ): Deck {
    const deck = this.resolveDeck(ref);
    let parentId = deck.parentId;
    if (patch.parent !== undefined) {
      if (patch.parent === null || patch.parent === '') parentId = null;
      else {
        const parent = this.resolveDeck(patch.parent, { create: true });
        if (subtreeIds(deck.id, this.decks()).has(parent.id)) throw new Error('Cannot move a deck inside itself.');
        parentId = parent.id;
      }
    }
    const next: Deck = {
      ...deck,
      name: patch.rename?.trim() ? patch.rename.trim().replace(/::/g, ':') : deck.name,
      parentId,
      description: patch.description ?? deck.description,
      emoji: patch.emoji ?? deck.emoji,
      config: patch.config ? { ...(deck.config ?? {}), ...stripUndefined(patch.config) } : deck.config,
    };
    return this.store.put('decks', [next])[0]!;
  }

  deleteDeck(ref: string, deleteNotes: boolean) {
    const deck = this.resolveDeck(ref);
    const decks = this.decks();
    const ids = subtreeIds(deck.id, decks);
    const notes = this.store.all('notes').filter((n) => ids.has(n.deckId));
    if (notes.length && !deleteNotes) {
      throw new Error(
        `Deck "${this.pathOf(deck.id)}" (incl. sub-decks) contains ${notes.length} notes. Pass delete_notes=true to delete them, or move them first.`,
      );
    }
    const noteIds = new Set(notes.map((n) => n.id));
    const cards = this.store.all('cards').filter((c) => noteIds.has(c.noteId));
    this.store.batch([
      { table: 'cards', remove: cards.map((c) => c.id) },
      { table: 'notes', remove: [...noteIds] },
      { table: 'decks', remove: [...ids] },
    ]);
    return { decks: ids.size, notes: noteIds.size, cards: cards.length };
  }

  cardsByNote(): Map<string, Card[]> {
    const m = new Map<string, Card[]>();
    for (const c of this.store.all('cards')) {
      const l = m.get(c.noteId) ?? [];
      l.push(c);
      m.set(c.noteId, l);
    }
    return m;
  }

  addNotes(inputs: NoteInput[], opts: { allowDuplicates?: boolean } = {}) {
    const now = Date.now();
    const seen = new Map<string, Note>();
    if (!opts.allowDuplicates) for (const n of this.store.all('notes')) seen.set(duplicateKey(n), n);
    const notes: Note[] = [];
    const cards: Card[] = [];
    const skipped: { index: number; text: string; existingId: string }[] = [];
    const errors: { index: number; error: string }[] = [];
    inputs.forEach((input, i) => {
      try {
        const { note, cards: cs } = makeNote(input, now, now + i);
        const key = duplicateKey(note);
        const dup = key ? seen.get(key) : undefined;
        if (dup && !opts.allowDuplicates) {
          skipped.push({ index: i, text: noteSummary(note), existingId: dup.id });
          return;
        }
        if (key) seen.set(key, note);
        notes.push(note);
        cards.push(...cs);
      } catch (e) {
        errors.push({ index: i, error: (e as Error).message });
      }
    });
    if (notes.length) this.store.batch([{ table: 'notes', put: notes }, { table: 'cards', put: cards }]);
    return { created: notes, skipped, errors };
  }

  updateNotes(updates: NoteUpdate[]) {
    const now = Date.now();
    const byNote = this.cardsByNote();
    const notesOut: Note[] = [];
    const cardsPut: Card[] = [];
    const cardsRemove: string[] = [];
    const errors: { id: string; error: string }[] = [];
    for (const u of updates) {
      const note = this.store.get('notes', u.id);
      if (!note) {
        errors.push({ id: u.id, error: 'note not found' });
        continue;
      }
      try {
        let tags = u.tags ?? note.tags;
        if (u.addTags?.length) tags = [...new Set([...tags, ...u.addTags])];
        if (u.removeTags?.length) {
          const rm = new Set(u.removeTags.map((t) => t.toLowerCase()));
          tags = tags.filter((t) => !rm.has(t.toLowerCase()));
        }
        const deckId = u.deck ? this.resolveDeck(u.deck, { create: true }).id : undefined;
        const next = patchNote(note, { fields: u.fields, tags, deckId }, now);
        const rec = reconcileCards(next, byNote.get(note.id) ?? [], now);
        notesOut.push(next);
        cardsPut.push(...rec.create, ...rec.update);
        cardsRemove.push(...rec.remove.map((c) => c.id));
      } catch (e) {
        errors.push({ id: u.id, error: (e as Error).message });
      }
    }
    this.store.batch([
      { table: 'notes', put: notesOut },
      { table: 'cards', put: cardsPut, remove: cardsRemove },
    ]);
    return { updated: notesOut, errors };
  }

  deleteNotes(ids: string[]) {
    const idSet = new Set(ids);
    const existing = ids.filter((id) => this.store.get('notes', id));
    const cards = this.store.all('cards').filter((c) => idSet.has(c.noteId));
    this.store.batch([
      { table: 'cards', remove: cards.map((c) => c.id) },
      { table: 'notes', remove: existing },
    ]);
    return { deleted: existing.length, missing: ids.length - existing.length };
  }

  moveNotes(ids: string[], deckRef: string) {
    const deck = this.resolveDeck(deckRef, { create: true });
    return { deck, ...this.updateNotes(ids.map((id) => ({ id, deck: deck.id }))) };
  }

  cardAction(noteIds: string[], action: 'suspend' | 'unsuspend' | 'forget' | 'bury' | 'unbury') {
    const now = Date.now();
    const ids = new Set(noteIds);
    const prefs = this.prefs();
    const cards = this.store.all('cards').filter((c) => ids.has(c.noteId));
    const out = cards.map((c) => {
      switch (action) {
        case 'suspend':
          return { ...c, suspended: 1 as const };
        case 'unsuspend':
          return { ...c, suspended: 0 as const };
        case 'forget':
          return forgetCard(c, now);
        case 'bury':
          return { ...c, buriedUntil: nextDayStartMs(now, prefs.rolloverHour) };
        case 'unbury':
          return { ...c, buriedUntil: 0 };
      }
    });
    this.store.put('cards', out);
    return { cards: out.length };
  }

  search(query: string, limit = 50, offset = 0) {
    const now = Date.now();
    const prefs = this.prefs();
    const byId = this.deckMap();
    const byNote = this.cardsByNote();
    const terms = parseQuery(query ?? '');
    const ctx = { now, dayEnd: nextDayStartMs(now, prefs.rolloverHour), ratedWithin: this.ratedWithinFn(now) };
    const results: { note: Note; cards: Card[]; deckPath: string }[] = [];
    const notes = this.store.all('notes').sort((a, b) => b.createdAt - a.createdAt);
    for (const note of notes) {
      const target = { note, cards: byNote.get(note.id) ?? [], deckPath: this.pathOf(note.deckId, byId) };
      if (matchesQuery(terms, target, ctx)) results.push(target);
    }
    return { total: results.length, results: results.slice(offset, offset + limit) };
  }

  private ratedWithinFn(now: number) {
    const cache = new Map<number, Set<string>>();
    return (days: number) => {
      let s = cache.get(days);
      if (!s) {
        s = new Set(this.store.all('revlog').filter((l) => l.review >= now - days * DAY).map((l) => l.noteId));
        cache.set(days, s);
      }
      return s;
    };
  }

  todayLogs(now = Date.now()): ReviewLog[] {
    const start = dayStartMs(now, this.prefs().rolloverHour);
    return this.store.all('revlog').filter((l) => l.review >= start);
  }

  deckSummaries(now = Date.now()) {
    const decks = this.decks();
    const cards = this.store.all('cards');
    const prefs = this.prefs();
    const counts = allDeckCounts({ decks, cards, todayLogs: this.todayLogs(now), now, rolloverHour: prefs.rolloverHour });
    const noteCounts = new Map<string, number>();
    for (const n of this.store.all('notes')) noteCounts.set(n.deckId, (noteCounts.get(n.deckId) ?? 0) + 1);
    return flattenTree(buildDeckTree(decks)).map((node) => {
      const ids = subtreeIds(node.deck.id, decks);
      let notes = 0;
      for (const id of ids) notes += noteCounts.get(id) ?? 0;
      return {
        id: node.deck.id,
        path: node.path,
        emoji: node.deck.emoji,
        description: node.deck.description,
        notes,
        due: counts.get(node.deck.id),
      };
    });
  }

  overview() {
    const now = Date.now();
    const prefs = this.prefs();
    const logs = this.store.all('revlog');
    const days = reviewsByDay(logs, prefs.rolloverHour);
    const cards = this.store.all('cards');
    const today = summarizeLogs(this.todayLogs(now));
    return {
      learner: { level: prefs.level, nativeLanguage: prefs.nativeLanguage, dailyGoal: prefs.dailyGoal, name: prefs.name },
      totals: { decks: this.store.count('decks'), notes: this.store.count('notes'), cards: cards.length, knownWords: knownNoteCount(cards) },
      cards: cardBreakdown(cards),
      today: { reviews: today.reviews, newLearned: today.learned, again: today.again, minutes: Math.round(today.timeMs / 60000) },
      streak: streak(days, now, prefs.rolloverHour),
      decks: this.deckSummaries(now),
    };
  }

  stats(daysBack = 30) {
    const now = Date.now();
    const prefs = this.prefs();
    const logs = this.store.all('revlog');
    const since = now - daysBack * DAY;
    const byDay = reviewsByDay(logs.filter((l) => l.review >= since), prefs.rolloverHour);
    const cards = this.store.all('cards');
    const notes = new Map(this.store.all('notes').map((n) => [n.id, n]));
    const byId = this.deckMap();
    const leechCards = cards
      .filter((c) => c.lapses >= 3)
      .sort((a, b) => b.lapses - a.lapses)
      .slice(0, 25);
    return {
      period: `${daysBack} days`,
      retention: retention(logs, since),
      reviewsPerDay: Object.fromEntries([...byDay.entries()].sort()),
      forecastNext14Days: forecast(cards, now, prefs.rolloverHour, 14),
      cards: cardBreakdown(cards),
      streak: streak(reviewsByDay(logs, prefs.rolloverHour), now, prefs.rolloverHour),
      difficult: leechCards.map((c) => {
        const n = notes.get(c.noteId);
        return {
          noteId: c.noteId,
          text: n ? noteSummary(n) : '?',
          deck: this.pathOf(c.deckId, byId),
          lapses: c.lapses,
          reps: c.reps,
          state: STATE_NAME[c.state],
          leech: c.lapses >= resolveDeckConfig(byId.get(c.deckId), byId).leechThreshold,
        };
      }),
      today: dayKey(now, prefs.rolloverHour),
    };
  }

  /** Compact JSON view of a note for AI tools. */
  describeNote(note: Note, cards: Card[], byId = this.deckMap(), now = Date.now()) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(note.fields)) if (v) fields[k] = v;
    return {
      id: note.id,
      type: note.type,
      deck: this.pathOf(note.deckId, byId),
      fields,
      tags: note.tags,
      cards: cards
        .sort((a, b) => a.ord - b.ord)
        .map((c) => ({
          ord: c.ord,
          state: STATE_NAME[c.state],
          due: c.state === CardState.New ? null : new Date(c.due).toISOString().slice(0, 10),
          overdue: c.state !== CardState.New && c.due < now,
          intervalDays: c.scheduledDays,
          lapses: c.lapses,
          reps: c.reps,
          suspended: !!c.suspended,
        })),
    };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export { makeDeck };
