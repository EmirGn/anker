import { resolveDeckConfig } from './config';
import { subtreeIds } from './decks';
import { MINUTE, nextDayStartMs } from './time';
import { CardState, type Card, type Deck, type DeckConfig, type ReviewLog } from './types';

export interface DeckCounts {
  new: number;
  learn: number;
  review: number;
}

export interface QueueSnapshot {
  learning: Card[];
  review: Card[];
  fresh: Card[];
  counts: DeckCounts;
}

export interface BuildQueueOptions {
  decks: Deck[];
  /** null = all decks */
  rootDeckId: string | null;
  cards: Card[];
  todayLogs: ReviewLog[];
  now: number;
  rolloverHour: number;
}

const isLearning = (c: Card) => c.state === CardState.Learning || c.state === CardState.Relearning;

/** Deterministic per-day shuffle so "random" new order is stable during a day. */
function dayShuffle<T extends { id: string }>(items: T[], seed: number): T[] {
  const hash = (s: string) => {
    let h = seed | 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
    return h >>> 0;
  };
  return [...items].sort((a, b) => hash(a.id) - hash(b.id));
}

export function buildQueue(opts: BuildQueueOptions): QueueSnapshot {
  const { decks, rootDeckId, cards, todayLogs, now, rolloverHour } = opts;
  const dayEnd = nextDayStartMs(now, rolloverHour);
  const byId = new Map(decks.map((d) => [d.id, d]));
  const scope = rootDeckId ? subtreeIds(rootDeckId, decks) : null;
  const inScope = (deckId: string) => (scope ? scope.has(deckId) : true);

  const cfgCache = new Map<string, DeckConfig>();
  const cfgOf = (deckId: string) => {
    let c = cfgCache.get(deckId);
    if (!c) {
      c = resolveDeckConfig(byId.get(deckId), byId);
      cfgCache.set(deckId, c);
    }
    return c;
  };

  // What was already done today, per deck.
  const newDone = new Map<string, number>();
  const revDone = new Map<string, number>();
  const notesSeenToday = new Set<string>();
  for (const l of todayLogs) {
    notesSeenToday.add(l.noteId);
    if (l.state === CardState.New) newDone.set(l.deckId, (newDone.get(l.deckId) ?? 0) + 1);
    else if (l.state === CardState.Review) revDone.set(l.deckId, (revDone.get(l.deckId) ?? 0) + 1);
  }
  const newLeft = new Map<string, number>();
  const revLeft = new Map<string, number>();
  const leftFor = (m: Map<string, number>, deckId: string, limit: number, done: Map<string, number>) => {
    if (!m.has(deckId)) m.set(deckId, Math.max(0, limit - (done.get(deckId) ?? 0)));
    return m.get(deckId)!;
  };

  // The deck you study caps its whole subtree; when studying everything, each
  // top-level deck caps its own subtree (so "Deutsch: 20 new/day" holds overall).
  const rootOf = new Map<string, string>();
  if (rootDeckId && scope) for (const id of scope) rootOf.set(id, rootDeckId);
  else {
    for (const d of decks) {
      let cur: Deck | undefined = d;
      const seen = new Set<string>();
      while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
        seen.add(cur.id);
        cur = byId.get(cur.parentId);
      }
      rootOf.set(d.id, cur?.id ?? d.id);
    }
  }
  const rootLeft = new Map<string, { n: number; r: number }>();
  const capsFor = (deckId: string) => {
    const rid = rootOf.get(deckId) ?? deckId;
    let caps = rootLeft.get(rid);
    if (!caps) {
      const rc = cfgOf(rid);
      let n = 0;
      let r = 0;
      for (const id of byId.has(rid) ? subtreeIds(rid, decks) : [rid]) {
        n += newDone.get(id) ?? 0;
        r += revDone.get(id) ?? 0;
      }
      caps = { n: Math.max(0, rc.newPerDay - n), r: Math.max(0, rc.reviewsPerDay - r) };
      rootLeft.set(rid, caps);
    }
    return caps;
  };

  const learning: Card[] = [];
  const reviewCandidates: Card[] = [];
  const newCandidates: Card[] = [];
  for (const c of cards) {
    if (c.suspended || !inScope(c.deckId)) continue;
    if (c.buriedUntil && c.buriedUntil > now) continue;
    if (isLearning(c)) {
      if (c.due < dayEnd) learning.push(c);
    } else if (c.state === CardState.Review) {
      if (c.due < dayEnd) reviewCandidates.push(c);
    } else if (c.state === CardState.New) {
      newCandidates.push(c);
    }
  }
  learning.sort((a, b) => a.due - b.due);
  const notesInQueue = new Set<string>(learning.map((c) => c.noteId));

  const skipSibling = (c: Card) =>
    cfgOf(c.deckId).burySiblings && (notesSeenToday.has(c.noteId) || notesInQueue.has(c.noteId));

  reviewCandidates.sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  const review: Card[] = [];
  for (const c of reviewCandidates) {
    const caps = capsFor(c.deckId);
    if (caps.r <= 0) continue;
    if (skipSibling(c)) continue;
    const cfg = cfgOf(c.deckId);
    const left = leftFor(revLeft, c.deckId, cfg.reviewsPerDay, revDone);
    if (left <= 0) continue;
    revLeft.set(c.deckId, left - 1);
    caps.r--;
    review.push(c);
    notesInQueue.add(c.noteId);
  }

  // New cards: group by order preference of their deck.
  const randomDecks = new Set(
    [...new Set(newCandidates.map((c) => c.deckId))].filter((d) => cfgOf(d).newOrder === 'random'),
  );
  const ordered = [
    ...newCandidates.filter((c) => !randomDecks.has(c.deckId)).sort((a, b) => a.position - b.position || a.ord - b.ord),
  ];
  const shuffled = dayShuffle(
    newCandidates.filter((c) => randomDecks.has(c.deckId)),
    Math.floor(dayEnd / 86_400_000),
  );
  const fresh: Card[] = [];
  for (const c of [...ordered, ...shuffled]) {
    const caps = capsFor(c.deckId);
    if (caps.n <= 0) continue;
    if (skipSibling(c)) continue;
    const cfg = cfgOf(c.deckId);
    const left = leftFor(newLeft, c.deckId, cfg.newPerDay, newDone);
    if (left <= 0) continue;
    newLeft.set(c.deckId, left - 1);
    caps.n--;
    fresh.push(c);
    notesInQueue.add(c.noteId);
  }

  return {
    learning,
    review,
    fresh,
    counts: { new: fresh.length, learn: learning.length, review: review.length },
  };
}

export type NextCard =
  | { kind: 'card'; card: Card; queue: 'learning' | 'review' | 'new' }
  | { kind: 'wait'; until: number }
  | { kind: 'done' };

/**
 * Mutable study session over a queue snapshot. Learning cards come back
 * when due; new cards are mixed in evenly among reviews.
 */
export class StudySession {
  private learning: Card[];
  private review: Card[];
  private fresh: Card[];
  private sinceNew = 0;
  readonly learnAheadMs: number;
  private dayEnd: number;

  constructor(snapshot: QueueSnapshot, opts: { now: number; rolloverHour: number; learnAheadMs?: number }) {
    this.learning = [...snapshot.learning];
    this.review = [...snapshot.review];
    this.fresh = [...snapshot.fresh];
    this.learnAheadMs = opts.learnAheadMs ?? 20 * MINUTE;
    this.dayEnd = nextDayStartMs(opts.now, opts.rolloverHour);
  }

  counts(): DeckCounts {
    return { new: this.fresh.length, learn: this.learning.length, review: this.review.length };
  }

  totalRemaining(): number {
    return this.learning.length + this.review.length + this.fresh.length;
  }

  next(now: number): NextCard {
    const dueLearning = this.learning.find((c) => c.due <= now);
    if (dueLearning) return { kind: 'card', card: dueLearning, queue: 'learning' };

    const hasReview = this.review.length > 0;
    const hasNew = this.fresh.length > 0;
    if (hasReview || hasNew) {
      const ratio = hasNew ? Math.max(1, Math.floor(this.review.length / this.fresh.length)) : Infinity;
      if (hasNew && (!hasReview || this.sinceNew >= ratio)) {
        return { kind: 'card', card: this.fresh[0]!, queue: 'new' };
      }
      return { kind: 'card', card: this.review[0]!, queue: 'review' };
    }

    const soon = this.learning[0];
    if (soon) {
      if (soon.due <= now + this.learnAheadMs) return { kind: 'card', card: soon, queue: 'learning' };
      return { kind: 'wait', until: soon.due };
    }
    return { kind: 'done' };
  }

  /** Remove a card from every queue (suspend, bury, delete...). */
  remove(cardId: string) {
    this.learning = this.learning.filter((c) => c.id !== cardId);
    this.review = this.review.filter((c) => c.id !== cardId);
    this.fresh = this.fresh.filter((c) => c.id !== cardId);
  }

  /** Record an answer: updates new/review mixing and requeues learning cards. */
  answered(updated: Card, queue: 'learning' | 'review' | 'new') {
    if (queue === 'new') this.sinceNew = 0;
    else if (queue === 'review') this.sinceNew++;
    this.requeue(updated);
  }

  /** Put an answered card back if it is still due today (learning steps). */
  requeue(card: Card) {
    this.remove(card.id);
    if ((card.state === CardState.Learning || card.state === CardState.Relearning) && card.due < this.dayEnd) {
      this.learning.push(card);
      this.learning.sort((a, b) => a.due - b.due);
    }
  }

  /** Undo support: put a card back at the front of its original queue. */
  restore(card: Card, queue: 'learning' | 'review' | 'new') {
    this.remove(card.id);
    if (queue === 'learning') {
      this.learning.push(card);
      this.learning.sort((a, b) => a.due - b.due);
    } else if (queue === 'review') this.review.unshift(card);
    else this.fresh.unshift(card);
  }

  /** Drop other cards of the same note (after bury / suspend note). */
  removeNote(noteId: string) {
    this.learning = this.learning.filter((c) => c.noteId !== noteId);
    this.review = this.review.filter((c) => c.noteId !== noteId);
    this.fresh = this.fresh.filter((c) => c.noteId !== noteId);
  }
}

/** Counts for every deck (including sub-decks) in one pass-friendly call. */
export function allDeckCounts(opts: Omit<BuildQueueOptions, 'rootDeckId'>): Map<string, DeckCounts> {
  const out = new Map<string, DeckCounts>();
  const byDeck = new Map<string, Card[]>();
  for (const c of opts.cards) {
    const l = byDeck.get(c.deckId) ?? [];
    l.push(c);
    byDeck.set(c.deckId, l);
  }
  for (const d of opts.decks) {
    const ids = subtreeIds(d.id, opts.decks);
    const cards: Card[] = [];
    for (const id of ids) cards.push(...(byDeck.get(id) ?? []));
    const logs = opts.todayLogs.filter((l) => ids.has(l.deckId));
    out.set(d.id, buildQueue({ ...opts, rootDeckId: d.id, cards, todayLogs: logs }).counts);
  }
  return out;
}
