import type { Deck } from './types';

export const DECK_SEP = '::';

export interface DeckNode {
  deck: Deck;
  path: string;
  depth: number;
  children: DeckNode[];
}

/** Build a deck forest from parentId links. Cycles / dangling parents become roots. */
export function buildDeckTree(decks: Deck[]): DeckNode[] {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const children = new Map<string | null, Deck[]>();
  for (const d of decks) {
    let parent = d.parentId && byId.has(d.parentId) ? d.parentId : null;
    if (parent && createsCycle(d.id, parent, byId)) parent = null;
    const list = children.get(parent) ?? [];
    list.push(d);
    children.set(parent, list);
  }
  const make = (d: Deck, prefix: string, depth: number): DeckNode => {
    const path = prefix ? `${prefix}${DECK_SEP}${d.name}` : d.name;
    const kids = (children.get(d.id) ?? []).sort(byName).map((c) => make(c, path, depth + 1));
    return { deck: d, path, depth, children: kids };
  };
  return (children.get(null) ?? []).sort(byName).map((d) => make(d, '', 0));
}

function byName(a: Deck, b: Deck) {
  return a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true });
}

function createsCycle(id: string, parentId: string, byId: Map<string, Deck>): boolean {
  const seen = new Set<string>([id]);
  let cur: string | null = parentId;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function flattenTree(nodes: DeckNode[]): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (n: DeckNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export function deckPath(deck: Deck, byId: Map<string, Deck>): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur: Deck | undefined = deck;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(DECK_SEP);
}

/** Ids of the deck and all its descendants. */
export function subtreeIds(rootId: string, decks: Deck[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const d of decks) {
    if (!d.parentId) continue;
    const l = kids.get(d.parentId) ?? [];
    l.push(d.id);
    kids.set(d.parentId, l);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** Find a deck by full path ("German::Verben"), case-insensitive. */
export function findDeckByPath(path: string, decks: Deck[]): Deck | undefined {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const target = normalizePath(path).toLowerCase();
  return decks.find((d) => deckPath(d, byId).toLowerCase() === target);
}

export function normalizePath(path: string): string {
  return path
    .split(DECK_SEP)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(DECK_SEP);
}
