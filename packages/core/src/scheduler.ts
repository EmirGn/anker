import {
  fsrs,
  generatorParameters,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
  type StepUnit,
} from 'ts-fsrs';
import { cardIdFor, newId } from './ids';
import { DAY, formatInterval } from './time';
import { CardState, type Card, type DeckConfig, type Rating, type ReviewLog } from './types';

const cache = new Map<string, FSRS>();

function schedulerFor(cfg: DeckConfig): FSRS {
  const key = JSON.stringify([
    cfg.desiredRetention,
    cfg.maximumInterval,
    cfg.learningSteps,
    cfg.relearningSteps,
  ]);
  let f = cache.get(key);
  if (!f) {
    f = fsrs(
      generatorParameters({
        request_retention: cfg.desiredRetention,
        maximum_interval: cfg.maximumInterval,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: sanitizeSteps(cfg.learningSteps, ['1m', '10m']),
        relearning_steps: sanitizeSteps(cfg.relearningSteps, ['10m']),
      }),
    );
    cache.set(key, f);
  }
  return f;
}

function sanitizeSteps(steps: string[] | undefined, fallback: StepUnit[]): StepUnit[] {
  if (!Array.isArray(steps)) return fallback;
  const ok = steps.filter((s): s is StepUnit => /^\d+(\.\d+)?[mhd]$/.test(s));
  return ok;
}

export function newCard(opts: {
  noteId: string;
  deckId: string;
  ord: number;
  now: number;
  position?: number;
}): Card {
  return {
    id: cardIdFor(opts.noteId, opts.ord),
    noteId: opts.noteId,
    deckId: opts.deckId,
    ord: opts.ord,
    due: opts.now,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: CardState.New,
    lastReview: null,
    suspended: 0,
    buriedUntil: 0,
    flag: 0,
    position: opts.position ?? opts.now,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

function toFsrs(card: Card, now: number): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.lastReview ? Math.max(0, Math.floor((now - card.lastReview) / DAY)) : 0,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  };
}

function fromFsrs(base: Card, f: FsrsCard, now: number): Card {
  return {
    ...base,
    due: f.due.getTime(),
    stability: f.stability,
    difficulty: f.difficulty,
    scheduledDays: f.scheduled_days,
    learningSteps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state as number as CardState,
    lastReview: f.last_review ? f.last_review.getTime() : now,
    buriedUntil: 0,
    updatedAt: now,
  };
}

export interface IntervalPreview {
  rating: Rating;
  due: number;
  label: string;
}

/** What each answer button would do, for the button labels ("10m", "4d"). */
export function previewCard(card: Card, cfg: DeckConfig, now: number): Record<Rating, IntervalPreview> {
  const f = schedulerFor(cfg);
  const preview = f.repeat(toFsrs(card, now), new Date(now));
  const out = {} as Record<Rating, IntervalPreview>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const item = preview[r as Grade];
    const due = item.card.due.getTime();
    out[r] = { rating: r, due, label: formatInterval(due - now) };
  }
  return out;
}

export interface AnswerResult {
  card: Card;
  log: ReviewLog;
}

export function answerCard(
  card: Card,
  rating: Rating,
  cfg: DeckConfig,
  now: number,
  durationMs: number,
): AnswerResult {
  const f = schedulerFor(cfg);
  const fc = toFsrs(card, now);
  const item = f.next(fc, new Date(now), rating as Grade);
  const next = fromFsrs(card, item.card, now);
  if (card.state !== CardState.New && rating === 1 && card.state === CardState.Review) {
    // ts-fsrs already increments lapses; nothing else to do.
  }
  const log: ReviewLog = {
    id: newId(),
    cardId: card.id,
    noteId: card.noteId,
    deckId: card.deckId,
    rating,
    state: card.state,
    scheduledDays: next.scheduledDays,
    intervalMs: next.due - now,
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: fc.elapsed_days,
    review: now,
    durationMs: Math.max(0, Math.min(durationMs, 5 * 60_000)),
    updatedAt: now,
  };
  return { card: next, log };
}

/** Reset a card to "new" (Anki: Forget). */
export function forgetCard(card: Card, now: number): Card {
  return {
    ...card,
    due: now,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: CardState.New,
    lastReview: null,
    buriedUntil: 0,
    updatedAt: now,
  };
}

/** Probability (0–1) that the card is currently remembered. New cards return null. */
export function retrievability(card: Card, cfg: DeckConfig, now: number): number | null {
  if (card.state === CardState.New || !card.lastReview) return null;
  const f = schedulerFor(cfg);
  return f.get_retrievability(toFsrs(card, now), new Date(now), false);
}

export function isLeech(card: Card, cfg: DeckConfig): boolean {
  return card.lapses >= cfg.leechThreshold;
}

export function cardIntervalDays(card: Card): number {
  if (!card.lastReview) return 0;
  return Math.max(0, (card.due - card.lastReview) / DAY);
}

export function isMature(card: Card): boolean {
  return card.state === CardState.Review && card.scheduledDays >= 21;
}
