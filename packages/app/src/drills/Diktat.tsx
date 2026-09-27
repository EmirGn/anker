import { Turtle, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { Button, cx } from '../components/ui';
import { diffAnswer, judgeAnswer } from '../lib/diff';
import { haptic, isNative } from '../lib/platform';
import { speak } from '../lib/tts';
import { GameShell, Results, saveBest, sentencePool, shuffle, StartScreen, useBest } from './shared';

const ROUNDS = 8;

export function Diktat() {
  const best = useBest('diktat');
  const [phase, setPhase] = useState<'start' | 'play' | 'done'>('start');
  const [items, setItems] = useState<{ de: string; en: string }[]>([]);
  const [round, setRound] = useState(0);
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<'exact' | 'close' | 'wrong' | null>(null);
  const [score, setScore] = useState(0);
  const [prevBest, setPrevBest] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const item = items[round];

  const play = (rate = 0.92) => item && void speak(item.de, { rate });

  const start = async () => {
    const pool = await sentencePool();
    setItems(shuffle(pool).slice(0, ROUNDS));
    setRound(0);
    setScore(0);
    setText('');
    setVerdict(null);
    setPhase('play');
  };

  useEffect(() => {
    if (phase === 'play' && item && !verdict) {
      const t = setTimeout(() => {
        void speak(item.de, { rate: 0.92 });
        ref.current?.focus();
      }, 250);
      return () => clearTimeout(t);
    }
  }, [phase, round, item]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'done') void saveBest('diktat', score).then(setPrevBest);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!item) return;
    if (verdict) {
      if (round + 1 >= ROUNDS) setPhase('done');
      else {
        setRound((r) => r + 1);
        setText('');
        setVerdict(null);
      }
      return;
    }
    const v = judgeAnswer(text, item.de);
    setVerdict(v);
    if (v !== 'wrong') setScore((s) => s + 1);
    void haptic(v === 'exact' ? 'success' : v === 'close' ? 'warning' : 'error');
  };

  if (phase === 'start')
    return (
      <GameShell title="Diktat">
        <StartScreen emoji="🎧" title="Diktat" onStart={() => void start()} best={best} bestLabel={`/${ROUNDS}`}>
          Listen to a sentence — from your own cards when you have enough — and write it down. Capitals, umlauts and ß count.
        </StartScreen>
      </GameShell>
    );
  if (phase === 'done')
    return (
      <GameShell title="Diktat">
        <Results score={score} total={ROUNDS} prevBest={prevBest} onAgain={() => void start()} />
      </GameShell>
    );
  if (!item) return null;
  const diff = verdict ? diffAnswer(text.trim(), item.de) : null;

  return (
    <GameShell title="Diktat" right={`${round + 1}/${ROUNDS}`} progress={(round + (verdict ? 1 : 0)) / ROUNDS}>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex gap-3">
          <Button variant="primary" className="size-20 rounded-full !px-0" onClick={() => play()} aria-label="Play">
            <Volume2 className="size-8" />
          </Button>
          <Button className="size-20 rounded-full !px-0" onClick={() => play(0.6)} aria-label="Play slowly">
            <Turtle className="size-7" />
          </Button>
        </div>
        <form
          className="w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!!verdict}
            placeholder="Schreib, was du hörst…"
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            lang="de"
            className={cx(
              'h-14 w-full rounded-2xl border-2 bg-surface px-4 font-display text-[20px] outline-none',
              !verdict ? 'border-line focus:border-accent' : verdict === 'exact' ? 'border-good' : verdict === 'close' ? 'border-hard' : 'border-again',
            )}
          />
          {!isNative && !verdict && <UmlautBar className="mt-2" onInsert={(ch) => insertAtCaret(ref.current, ch, setText)} />}
          {diff && (
            <div className="anim-in mt-4 space-y-2 rounded-2xl bg-surface-2 px-4 py-3">
              <div className="font-mono text-[15px] leading-relaxed">
                {diff.expected.map((s, i) => (
                  <span key={i} className={cx(s.kind === 'ok' ? 'text-good' : 'rounded bg-hard/25 text-ink underline decoration-hard decoration-2')}>
                    {s.text}
                  </span>
                ))}
              </div>
              <div className="text-[13.5px] text-muted">{item.en}</div>
              <div className={cx('text-[13px] font-semibold', verdict === 'exact' ? 'text-good' : verdict === 'close' ? 'text-hard' : 'text-again')}>
                {verdict === 'exact' ? 'Perfekt! ✓' : verdict === 'close' ? 'Almost — only capitals, umlauts or punctuation differ.' : 'Highlighted: what was missing or different.'}
              </div>
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" className="mt-4 w-full">
            {!verdict ? 'Check' : round + 1 >= ROUNDS ? 'Finish' : 'Next'}
          </Button>
        </form>
      </div>
    </GameShell>
  );
}
