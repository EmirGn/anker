import { informalTime } from '@anker/core';
import { Volume2 } from '../components/icons';
import { useEffect, useState } from 'react';
import { Button, cx } from '../components/ui';
import { haptic } from '../lib/platform';
import { speak } from '../lib/tts';
import { GameShell, Results, saveBest, shuffle, StartScreen, useBest } from './shared';
import { tr } from '../lib/i18n';

const ROUNDS = 10;
type T = { h: number; m: number };
const norm = (t: T): T => ({ h: ((t.h - 1 + 12) % 12) + 1, m: ((t.m % 60) + 60) % 60 });
const key = (t: T) => `${t.h}:${t.m}`;
const digital = (t: T) => `${t.h}:${String(t.m).padStart(2, '0')}`;

function Clock({ t, size = 200 }: { t: T; size?: number }) {
  const hourA = ((t.h % 12) + t.m / 60) * 30;
  const minA = t.m * 6;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-label={tr('Uhr zeigt {0}', digital(t))}>
      <circle cx="100" cy="100" r="94" fill="var(--paper-raised)" stroke="var(--line)" strokeWidth="3" />
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="100"
          y1={i % 5 === 0 ? 14 : 12}
          x2="100"
          y2={i % 5 === 0 ? 28 : 18}
          stroke={i % 5 === 0 ? 'var(--ink)' : 'var(--ink-muted)'}
          strokeWidth={i % 5 === 0 ? 3.5 : 1.5}
          strokeLinecap="round"
          transform={`rotate(${i * 6} 100 100)`}
        />
      ))}
      {[12, 3, 6, 9].map((n) => {
        const a = (n * 30 * Math.PI) / 180;
        return (
          <text key={n} x={100 + 58 * Math.sin(a)} y={100 - 58 * Math.cos(a) + 7} textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--ink-muted)" fontFamily="var(--font-sans)">
            {n}
          </text>
        );
      })}
      <line x1="100" y1="100" x2="100" y2="52" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" transform={`rotate(${hourA} 100 100)`} />
      <line x1="100" y1="100" x2="100" y2="26" stroke="var(--hafen)" strokeWidth="4.5" strokeLinecap="round" transform={`rotate(${minA} 100 100)`} />
      <circle cx="100" cy="100" r="6" fill="var(--ink)" />
    </svg>
  );
}

function makeRound() {
  const t = norm({ h: 1 + Math.floor(Math.random() * 12), m: Math.floor(Math.random() * 12) * 5 });
  const phrase = (x: T) => informalTime(x.h, x.m);
  const candidates = [
    { h: t.h - 1, m: t.m },
    { h: t.h + 1, m: t.m },
    { h: t.h, m: t.m + 30 },
    { h: t.h, m: 60 - t.m },
    { h: t.h - 1, m: 60 - t.m },
    { h: t.h, m: t.m + 15 },
    { h: t.h, m: t.m - 15 },
    { h: t.h + 1, m: t.m + 30 },
  ].map(norm);
  const seen = new Set([phrase(t)]);
  const wrong: T[] = [];
  for (const c of shuffle(candidates)) {
    const p = phrase(c);
    if (seen.has(p) || wrong.length >= 3) continue;
    seen.add(p);
    wrong.push(c);
  }
  return { t, options: shuffle([t, ...wrong]), mode: Math.random() < 0.5 ? ('read' as const) : ('listen' as const) };
}

export function Uhrzeit() {
  const best = useBest('uhrzeit');
  const [phase, setPhase] = useState<'start' | 'play' | 'done'>('start');
  const [round, setRound] = useState(0);
  const [q, setQ] = useState(makeRound);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [prevBest, setPrevBest] = useState<number | null>(null);

  const next = (r: number) => {
    const nq = makeRound();
    setQ(nq);
    setPicked(null);
    setRound(r);
    if (nq.mode === 'listen') setTimeout(() => void speak(informalTime(nq.t.h, nq.t.m)), 200);
  };

  const start = () => {
    setScore(0);
    setPhase('play');
    next(0);
  };

  const choose = (o: T) => {
    if (picked) return;
    const ok = key(o) === key(q.t);
    setPicked(key(o));
    if (ok) setScore((s) => s + 1);
    void haptic(ok ? 'success' : 'error');
    if (q.mode === 'read') void speak(informalTime(q.t.h, q.t.m));
  };

  useEffect(() => {
    if (phase === 'done') void saveBest('uhrzeit', score).then(setPrevBest);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'start')
    return (
      <GameShell title={tr('Wie spät ist es?')}>
        <StartScreen game="uhrzeit" title={tr('Wie spät ist es?')} onStart={start} best={best} bestLabel={`/${ROUNDS}`}>
          <b>{tr('halb acht')}</b>{' '}{tr('ist 7:30, nicht 8:30. Lies die Uhr oder hör die Uhrzeit und wähl die richtige Antwort.')}</StartScreen>
      </GameShell>
    );
  if (phase === 'done')
    return (
      <GameShell title={tr('Wie spät ist es?')}>
        <Results score={score} total={ROUNDS} prevBest={prevBest} onAgain={start} />
      </GameShell>
    );

  const answered = picked !== null;
  return (
    <GameShell title={tr('Wie spät ist es?')} right={`${round + 1}/${ROUNDS}`} progress={(round + (answered ? 1 : 0)) / ROUNDS}>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        {q.mode === 'read' ? (
          <>
            <Clock t={q.t} size={220} />
            <div className="grid w-full max-w-md gap-2">
              {q.options.map((o) => {
                const correct = key(o) === key(q.t);
                const mine = picked === key(o);
                return (
                  <button
                    key={key(o)}
                    onClick={() => choose(o)}
                    className={cx(
                      'h-14 rounded-md border text-[17px] font-medium transition-colors',
                      !answered && 'border-line bg-paper-raised hover:bg-paper-sunk',
                      answered && correct && 'border-wiese bg-wiese-soft text-wiese',
                      answered && mine && !correct && 'anim-shake border-koralle-ink bg-koralle-soft text-koralle-ink',
                      answered && !mine && !correct && 'border-line opacity-50',
                    )}
                  >
                    {informalTime(o.h, o.m)}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <Button className="size-20 rounded-full bg-krake-soft !px-0 text-krake-deep hover:bg-krake-soft hover:brightness-95" onClick={() => void speak(informalTime(q.t.h, q.t.m))} aria-label={tr('Noch mal anhören')}>
              <Volume2 className="size-8" />
            </Button>
            {answered && <div className="anim-in font-display text-[22px]">„{informalTime(q.t.h, q.t.m)}“</div>}
            <div className="grid grid-cols-2 gap-3">
              {q.options.map((o) => {
                const correct = key(o) === key(q.t);
                const mine = picked === key(o);
                return (
                  <button
                    key={key(o)}
                    onClick={() => choose(o)}
                    className={cx(
                      'flex flex-col items-center rounded-md border p-2 transition-colors',
                      !answered && 'border-line bg-paper-raised hover:bg-paper-sunk',
                      answered && correct && 'border-wiese bg-wiese-soft',
                      answered && mine && !correct && 'anim-shake border-koralle-ink bg-koralle-soft',
                      answered && !mine && !correct && 'border-line opacity-50',
                    )}
                  >
                    <Clock t={o} size={120} />
                    <span className="text-[13px] font-medium text-ink-muted tabular-nums">{digital(o)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {answered && (
          <Button variant="primary" size="lg" className="w-full max-w-md" onClick={() => (round + 1 >= ROUNDS ? setPhase('done') : next(round + 1))} autoFocus>
            {round + 1 >= ROUNDS ? tr('Fertig') : tr('Weiter')}
          </Button>
        )}
      </div>
    </GameShell>
  );
}
