import { describe, expect, it } from 'vitest';
import {
  answerCard,
  buildQueue,
  cardQA,
  CardState,
  clozeNumbers,
  DEFAULT_DECK_CONFIG,
  isNewer,
  matchesQuery,
  newCard,
  noteOrds,
  parseQuery,
  previewCard,
  renderCloze,
  StudySession,
  streak,
  reviewsByDay,
  MINUTE,
  DAY,
  type Deck,
  type Note,
  type ReviewLog,
} from '../src/index';

const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();

const deck = (id: string, parentId: string | null = null, config?: Deck['config']): Deck => ({
  id,
  name: id,
  parentId,
  config,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('scheduler', () => {
  it('moves a new card through learning steps', () => {
    const c = newCard({ noteId: 'n1', deckId: 'd', ord: 0, now: NOW });
    const p = previewCard(c, DEFAULT_DECK_CONFIG, NOW);
    expect(p[1].label).toBe('1m');
    expect(p[3].label).toBe('10m');
    const { card, log } = answerCard(c, 3, DEFAULT_DECK_CONFIG, NOW, 4000);
    expect(card.state).toBe(CardState.Learning);
    expect(card.due - NOW).toBe(10 * MINUTE);
    expect(log.state).toBe(CardState.New);
    expect(log.rating).toBe(3);
    // Graduate
    const later = NOW + 10 * MINUTE;
    const g = answerCard(card, 3, DEFAULT_DECK_CONFIG, later, 3000);
    expect(g.card.state).toBe(CardState.Review);
    expect(g.card.due - later).toBeGreaterThanOrEqual(DAY);
  });

  it('easy on a new card skips learning', () => {
    const c = newCard({ noteId: 'n1', deckId: 'd', ord: 0, now: NOW });
    const { card } = answerCard(c, 4, DEFAULT_DECK_CONFIG, NOW, 1000);
    expect(card.state).toBe(CardState.Review);
  });
});

describe('cloze', () => {
  it('finds numbers and renders sides', () => {
    const t = 'Ich fahre {{c1::mit dem}} Bus {{c2::zur::zu + der}} Arbeit.';
    expect(clozeNumbers(t)).toEqual([1, 2]);
    expect(renderCloze(t, 2, 'question')).toBe('Ich fahre mit dem Bus <span class="cloze">[zu + der]</span> Arbeit.');
    expect(renderCloze(t, 1, 'answer')).toContain('<span class="cloze-answer">mit dem</span>');
    expect(noteOrds({ type: 'cloze', fields: { text: t } })).toEqual([0, 1]);
  });
});

describe('note types', () => {
  it('word cards go both ways with article', () => {
    const fields = { german: 'Tisch', gender: 'der', english: 'table' };
    expect(cardQA({ type: 'word', fields }, 0)).toEqual({ question: 'der Tisch', answer: 'table' });
    expect(cardQA({ type: 'word', fields }, 1)).toEqual({ question: 'table', answer: 'der Tisch' });
  });
});

describe('queue', () => {
  const decks = [deck('root', null, { newPerDay: 3 }), deck('child', 'root', { newPerDay: 2 })];

  it('applies new limits per deck and at the root', () => {
    const cards = [
      ...[1, 2, 3, 4].map((i) => newCard({ noteId: `a${i}`, deckId: 'child', ord: 0, now: NOW + i })),
      ...[1, 2, 3, 4].map((i) => newCard({ noteId: `b${i}`, deckId: 'root', ord: 0, now: NOW + i })),
    ];
    const q = buildQueue({ decks, rootDeckId: 'root', cards, todayLogs: [], now: NOW, rolloverHour: 4 });
    expect(q.fresh.length).toBe(3);
    expect(q.fresh.filter((c) => c.deckId === 'child').length).toBeLessThanOrEqual(2);
  });

  it('studying all decks respects each top-level deck cap', () => {
    const tree = [deck('top', null, { newPerDay: 5 }), deck('a', 'top', { newPerDay: 4 }), deck('b', 'top', { newPerDay: 4 }), deck('solo', null, { newPerDay: 2 })];
    const cards = ['a', 'b', 'solo'].flatMap((d) =>
      [1, 2, 3, 4, 5].map((i) => newCard({ noteId: `${d}${i}`, deckId: d, ord: 0, now: NOW + i })),
    );
    const q = buildQueue({ decks: tree, rootDeckId: null, cards, todayLogs: [], now: NOW, rolloverHour: 4 });
    expect(q.fresh.filter((c) => c.deckId !== 'solo').length).toBe(5);
    expect(q.fresh.filter((c) => c.deckId === 'solo').length).toBe(2);
  });

  it('buries siblings of new cards', () => {
    const cards = [0, 1].map((ord) => newCard({ noteId: 'w', deckId: 'root', ord, now: NOW }));
    const q = buildQueue({ decks, rootDeckId: 'root', cards, todayLogs: [], now: NOW, rolloverHour: 4 });
    expect(q.fresh.length).toBe(1);
  });

  it('session interleaves and waits for learning cards', () => {
    const c = newCard({ noteId: 'x', deckId: 'root', ord: 0, now: NOW });
    const q = buildQueue({ decks, rootDeckId: 'root', cards: [c], todayLogs: [], now: NOW, rolloverHour: 4 });
    const s = new StudySession(q, { now: NOW, rolloverHour: 4, learnAheadMs: 0 });
    const n = s.next(NOW);
    expect(n.kind).toBe('card');
    const { card } = answerCard(c, 1, DEFAULT_DECK_CONFIG, NOW, 1000);
    s.answered(card, 'new');
    const w = s.next(NOW);
    expect(w).toEqual({ kind: 'wait', until: card.due });
    expect(s.next(card.due).kind).toBe('card');
  });

  it('counts review limits using today logs', () => {
    const d = [deck('r', null, { reviewsPerDay: 2 })];
    const cards = [1, 2, 3].map((i) => ({
      ...newCard({ noteId: `n${i}`, deckId: 'r', ord: 0, now: NOW - 10 * DAY }),
      state: CardState.Review,
      due: NOW - DAY,
      lastReview: NOW - 5 * DAY,
      scheduledDays: 4,
      stability: 4,
      difficulty: 5,
    }));
    const log: ReviewLog = {
      id: 'l1', cardId: 'zz', noteId: 'zz', deckId: 'r', rating: 3, state: CardState.Review, scheduledDays: 5,
      intervalMs: 5 * DAY, stability: 5, difficulty: 5, elapsedDays: 4, review: NOW - MINUTE, durationMs: 1000, updatedAt: NOW,
    };
    const q = buildQueue({ decks: d, rootDeckId: 'r', cards, todayLogs: [log], now: NOW, rolloverHour: 4 });
    expect(q.review.length).toBe(1);
  });
});

describe('search', () => {
  const note: Note = {
    id: 'n1', deckId: 'd', type: 'word', tags: ['A1', 'küche'], createdAt: NOW, updatedAt: NOW,
    fields: { german: 'Löffel', gender: 'der', english: 'spoon', pos: 'noun' },
  };
  const target = { note, cards: [newCard({ noteId: 'n1', deckId: 'd', ord: 0, now: NOW })], deckPath: 'Deutsch::Küche' };
  const ctx = { now: NOW, dayEnd: NOW + DAY };
  it.each([
    ['loffel', true],
    ['spoon deck:deutsch', true],
    ['deck:Deutsch::Küche', true],
    ['deck:Deutsch::K*', true],
    ['deck:Deu', false],
    ['gender:der', true],
    ['gender:die', false],
    ['tag:kuche', true],
    ['-tag:a1', false],
    ['is:new', true],
    ['is:due', false],
    ['english:spo', true],
    ['"spoon"', true],
  ])('%s → %s', (q, expected) => expect(matchesQuery(parseQuery(q), target, ctx)).toBe(expected));
});

describe('stats', () => {
  it('computes streaks', () => {
    const mk = (daysAgo: number): ReviewLog => ({
      id: `l${daysAgo}`, cardId: 'c', noteId: 'n', deckId: 'd', rating: 3, state: CardState.Review, scheduledDays: 1,
      intervalMs: DAY, stability: 1, difficulty: 5, elapsedDays: 1, review: NOW - daysAgo * DAY, durationMs: 1000, updatedAt: NOW,
    });
    const days = reviewsByDay([mk(0), mk(1), mk(2), mk(4)], 4);
    expect(streak(days, NOW, 4)).toEqual({ current: 3, longest: 3, reviewedToday: true });
  });
});

describe('sync', () => {
  it('last writer wins, ties go to deletion', () => {
    expect(isNewer({ updatedAt: 2 }, { updatedAt: 1 })).toBe(true);
    expect(isNewer({ updatedAt: 1 }, { updatedAt: 2 })).toBe(false);
    expect(isNewer({ updatedAt: 1, deleted: true }, { updatedAt: 1 })).toBe(true);
    expect(isNewer({ updatedAt: 1 }, undefined)).toBe(true);
  });
});
