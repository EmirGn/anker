import { CheckCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { euroToGerman, formatEuro, numberToGerman, yearToGerman } from '@anker/core';
import { Turtle, Volume2 } from '../components/icons';
import { useEffect, useRef, useState } from 'react';
import { Button, cx, Segmented } from '../components/ui';
import { haptic } from '../lib/platform';
import { speak } from '../lib/tts';
import { GameShell, Results, saveBest, StartScreen, useBest } from './shared';
import { tr } from '../lib/i18n';

type Level = 'easy' | 'tens' | 'hundreds' | 'thousands' | 'years' | 'prices';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'easy', label: '0–20' },
  { value: 'tens', label: '21–99' },
  { value: 'hundreds', label: '100–999' },
  { value: 'thousands', label: '1.000+' },
  { value: 'years', label: tr('Jahre') },
  { value: 'prices', label: tr('Preise') },
];
const ROUNDS = 10;
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

interface Item {
  value: number;
  spoken: string;
  words: string;
  display: string;
}

function makeItem(level: Level): Item {
  switch (level) {
    case 'easy': {
      const n = rnd(0, 20);
      return { value: n, spoken: numberToGerman(n), words: numberToGerman(n), display: String(n) };
    }
    case 'tens': {
      const n = rnd(21, 99);
      return { value: n, spoken: numberToGerman(n), words: numberToGerman(n), display: String(n) };
    }
    case 'hundreds': {
      const n = rnd(100, 999);
      return { value: n, spoken: numberToGerman(n), words: numberToGerman(n), display: String(n) };
    }
    case 'thousands': {
      const n = Math.random() < 0.5 ? rnd(1000, 9999) : rnd(10_000, 99_999);
      return { value: n, spoken: numberToGerman(n), words: numberToGerman(n), display: n.toLocaleString('de-DE') };
    }
    case 'years': {
      const n = rnd(1850, 2035);
      return { value: n, spoken: yearToGerman(n), words: yearToGerman(n), display: String(n) };
    }
    case 'prices': {
      const a = Math.max(0.5, rnd(0, 49) + rnd(0, 19) * 5 / 100);
      return { value: a, spoken: euroToGerman(a), words: euroToGerman(a), display: formatEuro(a) };
    }
  }
}

function parseAnswer(s: string, level: Level): number | null {
  const t = s.trim().replace(/€/g, '').replace(/\s/g, '');
  if (!t) return null;
  if (level === 'prices') {
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  const n = Number(t.replace(/\./g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function Zahlen() {
  const best = useBest('zahlen');
  const [level, setLevel] = useState<Level>('tens');
  const [phase, setPhase] = useState<'start' | 'play' | 'done'>('start');
  const [round, setRound] = useState(0);
  const [item, setItem] = useState<Item | null>(null);
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [prevBest, setPrevBest] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const next = (r: number) => {
    const it = makeItem(level);
    setItem(it);
    setInput('');
    setChecked(null);
    setRound(r);
    setTimeout(() => {
      inputRef.current?.focus();
      void speak(it.spoken);
    }, 150);
  };

  const start = () => {
    setScore(0);
    setPhase('play');
    next(0);
  };

  const check = () => {
    if (!item) return;
    if (checked !== null) {
      if (round + 1 >= ROUNDS) setPhase('done');
      else next(round + 1);
      return;
    }
    const v = parseAnswer(input, level);
    const ok = v !== null && Math.abs(v - item.value) < 0.001;
    setChecked(ok);
    if (ok) setScore((s) => s + 1);
    void haptic(ok ? 'success' : 'error');
  };

  useEffect(() => {
    if (phase === 'done') void saveBest('zahlen', score).then(setPrevBest);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'start')
    return (
      <GameShell title={tr('Zahlen-Diktat')}>
        <StartScreen game="zahlen" title={tr('Zahlen-Diktat')} onStart={start} best={best} bestLabel={`/${ROUNDS}`}>{tr('Im Deutschen kommen die Einer zuerst:')}{' '}<b>{tr('vierundzwanzig')}</b>{' '}{tr('= vier und zwanzig. Hör zu und tipp die Zahl.')}<div className="mt-5 flex justify-center">
            <Segmented value={level} onChange={setLevel} options={LEVELS} size="sm" className="flex-wrap" />
          </div>
        </StartScreen>
      </GameShell>
    );

  if (phase === 'done')
    return (
      <GameShell title={tr('Zahlen-Diktat')}>
        <Results score={score} total={ROUNDS} prevBest={prevBest} onAgain={start} />
      </GameShell>
    );

  return (
    <GameShell title={tr('Zahlen-Diktat')} right={`${round + 1}/${ROUNDS}`} progress={(round + (checked !== null ? 1 : 0)) / ROUNDS}>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex gap-3">
          <Button size="lg" className="size-20 rounded-full bg-krake-soft !px-0 text-krake-deep hover:bg-krake-soft hover:brightness-95" onClick={() => item && void speak(item.spoken)} aria-label={tr('Noch mal anhören')}>
            <Volume2 className="size-8" />
          </Button>
          <Button size="lg" className="size-20 rounded-full !px-0" onClick={() => item && void speak(item.spoken, { rate: 0.6 })} aria-label={tr('Langsam anhören')}>
            <Turtle className="size-7" />
          </Button>
        </div>
        <form
          className="w-full max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode="decimal"
            placeholder={level === 'prices' ? '3,50' : '…'}
            readOnly={checked !== null}
            className={cx(
              'h-16 w-full rounded-md border-2 bg-paper-raised text-center font-display text-[28px] tabular-nums outline-none',
              checked === null ? 'border-line focus:border-hafen' : checked ? 'border-wiese text-wiese' : 'anim-shake border-koralle-ink text-koralle-ink',
            )}
          />
          <Button type="submit" variant="primary" size="lg" className="mt-3 w-full">
            {checked === null ? tr('Prüfen') : round + 1 >= ROUNDS ? tr('Fertig') : tr('Weiter')}
          </Button>
        </form>
        {checked !== null && item && (
          <div className="anim-in text-center">
            <div className={cx('t-label mb-1 flex items-center justify-center gap-1.5', checked ? 'text-wiese' : 'text-koralle-ink')}>
              {checked ? <CheckCircleIcon weight="fill" className="anim-pop size-5" /> : <XCircleIcon weight="fill" className="size-5" />}
              {checked ? tr('Richtig') : tr('Nicht ganz')}
            </div>
            <div className="t-title tabular-nums">{item.display}</div>
            <div className="mt-1 font-display text-[20px] text-ink-muted">{item.words}</div>
          </div>
        )}
      </div>
    </GameShell>
  );
}
