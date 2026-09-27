import { builtinNouns, builtinSentences, builtinVerbs, parseGender, parseVerbForms, plainText, type Gender, type PoolNoun, type PoolVerb } from '@anker/core';
import { Trophy, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, cx, IconButton } from '../components/ui';
import { db, getMeta, setMeta } from '../lib/db';
import { navigate } from '../lib/router';

export function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)]!;
}

/** Built-in nouns + the learner's own nouns (theirs first, deduplicated). */
export async function nounPool(): Promise<(PoolNoun & { own: boolean })[]> {
  const notes = await db.notes.where('type').equals('word').toArray();
  const own = notes
    .map((n) => ({ word: plainText(n.fields.german ?? ''), gender: parseGender(n.fields.gender) as Gender, plural: plainText(n.fields.plural ?? ''), meaning: plainText(n.fields.english ?? ''), own: true }))
    .filter((n) => n.gender && n.word && /^[A-ZÄÖÜ]/.test(n.word) && !n.word.includes(' '));
  const seen = new Set(own.map((n) => n.word.toLowerCase()));
  return [...own, ...builtinNouns().filter((n) => !seen.has(n.word.toLowerCase())).map((n) => ({ ...n, own: false }))];
}

export async function verbPool(): Promise<(PoolVerb & { own: boolean })[]> {
  const notes = await db.notes.where('type').equals('word').toArray();
  const own = notes
    .filter((n) => n.fields.pos === 'verb' && parseVerbForms(n.fields.forms).aux)
    .map((n) => ({ infinitive: plainText(n.fields.german ?? ''), meaning: plainText(n.fields.english ?? ''), forms: plainText(n.fields.forms ?? ''), own: true }));
  const seen = new Set(own.map((v) => v.infinitive));
  return [...own, ...builtinVerbs().filter((v) => !seen.has(v.infinitive)).map((v) => ({ ...v, own: false }))];
}

export async function sentencePool(): Promise<{ de: string; en: string }[]> {
  const notes = await db.notes.where('type').equals('word').toArray();
  const own = notes
    .filter((n) => n.fields.example)
    .map((n) => ({ de: plainText(n.fields.example!), en: plainText(n.fields.exampleTranslation ?? '') }))
    .filter((s) => s.de.split(' ').length <= 12);
  return own.length >= 12 ? own : [...own, ...builtinSentences()];
}

export async function recordItem(game: string, item: string, right: boolean) {
  const key = `${game}:${item}`;
  const cur = await db.drillStats.get(key);
  await db.drillStats.put({
    key,
    game,
    item,
    right: (cur?.right ?? 0) + (right ? 1 : 0),
    wrong: (cur?.wrong ?? 0) + (right ? 0 : 1),
    lastAt: Date.now(),
  });
}

export async function missedItems(game: string): Promise<Set<string>> {
  const rows = await db.drillStats.where('game').equals(game).toArray();
  return new Set(rows.filter((r) => r.wrong > r.right).map((r) => r.item));
}

/** Save a best score; returns the previous best. */
export async function saveBest(game: string, score: number): Promise<number | null> {
  const prev = await getMeta<number | null>(`best:${game}`, null);
  if (prev === null || score > prev) await setMeta(`best:${game}`, score);
  return prev;
}

export function useBest(game: string) {
  const [best, setBest] = useState<number | null>(null);
  useEffect(() => {
    void getMeta<number | null>(`best:${game}`, null).then(setBest);
  }, [game]);
  return best;
}

export function GameShell({ title, right, children, progress }: { title: string; right?: ReactNode; children: ReactNode; progress?: number }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="pt-safe sticky top-0 z-10 bg-bg/85 backdrop-blur-xl">
        <div className="drag mx-auto flex h-14 max-w-3xl items-center gap-2 px-3 md:h-16 md:px-6">
          <IconButton label="Exit" onClick={() => navigate('/practice')} className="no-drag">
            <X className="size-5" />
          </IconButton>
          <div className="min-w-0 flex-1 truncate text-center font-display text-[17px] font-semibold">{title}</div>
          <div className="no-drag min-w-9 text-right text-[14px] font-semibold tabular-nums">{right}</div>
        </div>
        {progress !== undefined && (
          <div className="h-[3px] bg-surface-2">
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(1, progress) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 md:py-10">{children}</div>
    </div>
  );
}

export function StartScreen({ emoji, title, children, onStart, best, bestLabel }: { emoji: string; title: string; children: ReactNode; onStart: () => void; best: number | null; bestLabel?: string }) {
  return (
    <div className="anim-in flex flex-1 flex-col items-center justify-center text-center">
      <div className="text-6xl">{emoji}</div>
      <h1 className="mt-4 font-display text-[32px] font-semibold">{title}</h1>
      <div className="mt-2 max-w-md text-[15px] text-muted">{children}</div>
      {best !== null && (
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium text-muted">
          <Trophy className="size-3.5 text-hard" /> Best: {best}
          {bestLabel}
        </div>
      )}
      <Button variant="primary" size="lg" className="mt-8 min-w-44" onClick={onStart} autoFocus>
        Start
      </Button>
    </div>
  );
}

export function Results({
  score,
  total,
  prevBest,
  onAgain,
  children,
  unit = '',
}: {
  score: number;
  total?: number;
  prevBest: number | null;
  onAgain: () => void;
  children?: ReactNode;
  unit?: string;
}) {
  const record = prevBest === null || score > prevBest;
  const ratio = total ? score / total : null;
  const msg = ratio === null ? (record ? 'Neuer Rekord!' : 'Gut gemacht!') : ratio >= 0.9 ? 'Ausgezeichnet!' : ratio >= 0.7 ? 'Sehr gut!' : ratio >= 0.5 ? 'Nicht schlecht!' : 'Übung macht den Meister!';
  return (
    <div className="anim-in flex flex-1 flex-col items-center text-center">
      <div className="text-6xl">{record && score > 0 ? '🏆' : ratio !== null && ratio >= 0.7 ? '🎉' : '💪'}</div>
      <h1 className="mt-4 font-display text-[32px] font-semibold">{msg}</h1>
      <div className="mt-2 font-display text-[56px] leading-none font-semibold tabular-nums">
        {score}
        {total !== undefined && <span className="text-[28px] text-faint">/{total}</span>}
        {unit}
      </div>
      <div className={cx('mt-2 text-[14px]', record && score > 0 ? 'font-semibold text-hard' : 'text-muted')}>
        {record && score > 0 ? (prevBest === null ? 'Your first score!' : `New best (was ${prevBest})`) : `Best: ${prevBest}`}
      </div>
      {children && <div className="mt-8 w-full text-left">{children}</div>}
      <div className="mt-8 flex w-full max-w-sm flex-col gap-2">
        <Button variant="primary" size="lg" onClick={onAgain} autoFocus>
          Play again
        </Button>
        <Button size="lg" variant="ghost" onClick={() => navigate('/practice')}>
          Other games
        </Button>
      </div>
    </div>
  );
}
