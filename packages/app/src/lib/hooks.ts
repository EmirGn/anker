import {
  allDeckCounts,
  buildDeckTree,
  dayStartMs,
  DEFAULT_PREFS,
  withPrefDefaults,
  type Deck,
  type DeckCounts,
  type Prefs,
} from '@anker/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db } from './db';
import { hub, onHubChange } from './hub';
import { getSyncState, onSyncState } from './sync';
import { getThemePref, onThemeChange, resolvedTheme } from './theme';

export { useLiveQuery };

export function usePrefs(): Prefs {
  return useLiveQuery(async () => withPrefDefaults(await db.prefs.get('global')), [], withPrefDefaults({ ...DEFAULT_PREFS }));
}

export function useDecks(): Deck[] | undefined {
  return useLiveQuery(() => db.decks.toArray(), []);
}

export function useDeckTree() {
  const decks = useDecks();
  return useMemo(() => (decks ? buildDeckTree(decks) : undefined), [decks]);
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useDayStart(): number {
  const prefs = usePrefs();
  const now = useNow(60_000);
  return dayStartMs(now, prefs.rolloverHour);
}

export function useTodayLogs() {
  const start = useDayStart();
  return useLiveQuery(() => db.revlog.where('review').aboveOrEqual(start).toArray(), [start]);
}

/** Due counts for all decks (recomputed when cards / logs change). */
export function useDeckCounts(): Map<string, DeckCounts> | undefined {
  const prefs = usePrefs();
  const start = useDayStart();
  const minute = Math.floor(useNow(60_000) / 60_000);
  return useLiveQuery(async () => {
    const [decks, cards, logs] = await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
      db.revlog.where('review').aboveOrEqual(start).toArray(),
    ]);
    return allDeckCounts({ decks, cards, todayLogs: logs, now: Date.now(), rolloverHour: prefs.rolloverHour });
  }, [prefs.rolloverHour, start, minute]);
}

export function useSyncState() {
  return useSyncExternalStore(onSyncState, getSyncState);
}

export function useHub() {
  return useSyncExternalStore(onHubChange, hub);
}

export function useTheme(): 'light' | 'dark' {
  return useSyncExternalStore(onThemeChange, () => resolvedTheme(getThemePref()));
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    fn();
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}

export function useIsWide() {
  return useMediaQuery('(min-width: 900px)');
}

/** Global keyboard shortcuts; ignored while typing in inputs unless `allowInInput`. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[], allowInInput = false) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push('mod');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey && e.key.length > 1) parts.push('shift');
      parts.push(e.key === ' ' ? 'space' : e.key.toLowerCase());
      const combo = parts.join('+');
      const fn = map[combo];
      if (!fn) return;
      if (typing && !allowInInput && !combo.startsWith('mod+')) return;
      fn(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
