import { addDaysKey, dayKey, dayStartMs, DAY } from './time';
import { CardState, type Card, type ReviewLog } from './types';

export interface DayStat {
  count: number;
  timeMs: number;
  again: number;
  learned: number;
}

export function reviewsByDay(logs: ReviewLog[], rolloverHour: number): Map<string, DayStat> {
  const out = new Map<string, DayStat>();
  for (const l of logs) {
    const k = dayKey(l.review, rolloverHour);
    const s = out.get(k) ?? { count: 0, timeMs: 0, again: 0, learned: 0 };
    s.count++;
    s.timeMs += l.durationMs;
    if (l.rating === 1) s.again++;
    if (l.state === CardState.New) s.learned++;
    out.set(k, s);
  }
  return out;
}

export function streak(days: Map<string, DayStat>, now: number, rolloverHour: number) {
  const today = dayKey(now, rolloverHour);
  const reviewedToday = (days.get(today)?.count ?? 0) > 0;
  let current = 0;
  let k = reviewedToday ? today : addDaysKey(today, -1);
  while ((days.get(k)?.count ?? 0) > 0) {
    current++;
    k = addDaysKey(k, -1);
  }
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of [...days.keys()].sort()) {
    if ((days.get(key)?.count ?? 0) === 0) continue;
    run = prev && addDaysKey(prev, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = key;
  }
  return { current, longest: Math.max(longest, current), reviewedToday };
}

/** Due cards per day for the next `days` days (index 0 = today, including overdue). */
export function forecast(cards: Card[], now: number, rolloverHour: number, days = 30): number[] {
  const start = dayStartMs(now, rolloverHour);
  const out = new Array<number>(days).fill(0);
  for (const c of cards) {
    if (c.suspended || c.state === CardState.New) continue;
    const idx = Math.max(0, Math.floor((c.due - start) / DAY));
    if (idx < days) out[idx]!++;
  }
  return out;
}

export interface CardBreakdown {
  total: number;
  new: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
}

export function cardBreakdown(cards: Card[]): CardBreakdown {
  const b: CardBreakdown = { total: cards.length, new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  for (const c of cards) {
    if (c.suspended) {
      b.suspended++;
      continue;
    }
    if (c.state === CardState.New) b.new++;
    else if (c.state === CardState.Learning || c.state === CardState.Relearning) b.learning++;
    else if (c.scheduledDays >= 21) b.mature++;
    else b.young++;
  }
  return b;
}

/** True retention on review cards (share of reviews not answered "Again"). */
export function retention(logs: ReviewLog[], sinceMs: number) {
  let reviews = 0;
  let passed = 0;
  for (const l of logs) {
    if (l.review < sinceMs || l.state !== CardState.Review) continue;
    reviews++;
    if (l.rating > 1) passed++;
  }
  return { reviews, passed, rate: reviews ? passed / reviews : null };
}

export function summarizeLogs(logs: ReviewLog[]) {
  let timeMs = 0;
  let again = 0;
  let learned = 0;
  for (const l of logs) {
    timeMs += l.durationMs;
    if (l.rating === 1) again++;
    if (l.state === CardState.New) learned++;
  }
  return {
    reviews: logs.length,
    timeMs,
    again,
    learned,
    correctRate: logs.length ? (logs.length - again) / logs.length : null,
  };
}

/** Rating distribution by answer button. */
export function answerButtons(logs: ReviewLog[]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const l of logs) out[l.rating - 1]++;
  return out;
}

/** Notes you know: at least one card in review state and not currently lapsed. */
export function knownNoteCount(cards: Card[]): number {
  const known = new Set<string>();
  for (const c of cards) if (c.state === CardState.Review && !c.suspended) known.add(c.noteId);
  return known.size;
}

/** Hour-of-day performance (0..23): reviews and pass rate. */
export function hourlyBreakdown(logs: ReviewLog[]) {
  const hours = Array.from({ length: 24 }, () => ({ reviews: 0, passed: 0 }));
  for (const l of logs) {
    const h = new Date(l.review).getHours();
    hours[h]!.reviews++;
    if (l.rating > 1) hours[h]!.passed++;
  }
  return hours;
}
