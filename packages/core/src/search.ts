import { DEFAULT_DECK_CONFIG } from './config';
import { parseGender, parsePos } from './german/articles';
import { normalizeForSearch } from './text';
import { DAY } from './time';
import { CardState, type Card, type Note } from './types';

export interface SearchTerm {
  neg: boolean;
  key: string | null;
  value: string;
}

const TERM_RE = /(-?)(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g;

export function parseQuery(q: string): SearchTerm[] {
  const out: SearchTerm[] = [];
  for (const m of q.matchAll(TERM_RE)) {
    const value = (m[3] ?? m[4] ?? '').trim();
    if (!value && !m[2]) continue;
    out.push({ neg: m[1] === '-', key: m[2]?.toLowerCase() ?? null, value });
  }
  return out;
}

export interface SearchTarget {
  note: Note;
  cards: Card[];
  deckPath: string;
}

export interface SearchContext {
  now: number;
  dayEnd: number;
  leechThreshold?: number;
  /** note ids reviewed in the last N days, keyed by N (for rated:N) */
  ratedWithin?: (days: number) => Set<string>;
}

function wildcard(value: string): RegExp {
  const esc = normalizeForSearch(value).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`);
}

function cardIs(c: Card, what: string, ctx: SearchContext): boolean {
  switch (what) {
    case 'new':
      return c.state === CardState.New;
    case 'learn':
    case 'learning':
      return c.state === CardState.Learning || c.state === CardState.Relearning;
    case 'review':
      return c.state === CardState.Review;
    case 'due':
      return !c.suspended && c.state !== CardState.New && c.due < ctx.dayEnd;
    case 'suspended':
      return c.suspended === 1;
    case 'buried':
      return c.buriedUntil > ctx.now;
    case 'flagged':
      return c.flag > 0;
    case 'leech':
      return c.lapses >= (ctx.leechThreshold ?? DEFAULT_DECK_CONFIG.leechThreshold);
    case 'mature':
      return c.state === CardState.Review && c.scheduledDays >= 21;
    case 'young':
      return c.state === CardState.Review && c.scheduledDays < 21;
    default:
      return false;
  }
}

function termMatches(t: SearchTerm, target: SearchTarget, ctx: SearchContext, haystack: () => string): boolean {
  const { note, cards } = target;
  const v = t.value;
  switch (t.key) {
    case null:
      return haystack().includes(normalizeForSearch(v));
    case 'deck': {
      const path = normalizeForSearch(target.deckPath);
      const want = normalizeForSearch(v);
      if (v.includes('*')) return wildcard(v).test(path);
      return path === want || path.startsWith(`${want}::`);
    }
    case 'tag':
      return note.tags.some((tag) => (v.includes('*') ? wildcard(v).test(normalizeForSearch(tag)) : normalizeForSearch(tag) === normalizeForSearch(v)));
    case 'is':
      return cards.some((c) => cardIs(c, v.toLowerCase(), ctx));
    case 'type':
    case 'note':
      return note.type === v.toLowerCase();
    case 'gender':
      return note.type === 'word' && parseGender(note.fields.gender) === parseGender(v);
    case 'pos':
      return note.type === 'word' && note.fields.pos === parsePos(v);
    case 'flag':
      return cards.some((c) => c.flag === Number(v));
    case 'added': {
      const days = Number(v) || 1;
      return note.createdAt >= ctx.now - days * DAY;
    }
    case 'rated': {
      const days = Number(v) || 1;
      return ctx.ratedWithin ? ctx.ratedWithin(days).has(note.id) : false;
    }
    case 'source':
      return (note.source ?? 'user') === v.toLowerCase();
    case 'id':
    case 'nid':
      return note.id === v;
    default: {
      // field:value
      const field = note.fields[t.key];
      if (field === undefined) return false;
      if (v.includes('*')) return wildcard(v).test(normalizeForSearch(field));
      return normalizeForSearch(field).includes(normalizeForSearch(v));
    }
  }
}

export function matchesQuery(terms: SearchTerm[], target: SearchTarget, ctx: SearchContext): boolean {
  let hay: string | null = null;
  const haystack = () => {
    if (hay === null) hay = normalizeForSearch(`${Object.values(target.note.fields).join(' \u0001 ')} \u0001 ${target.note.tags.join(' ')}`);
    return hay;
  };
  for (const t of terms) {
    const ok = termMatches(t, target, ctx, haystack);
    if (t.neg ? ok : !ok) return false;
  }
  return true;
}
