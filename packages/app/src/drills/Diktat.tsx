import { Turtle, Volume2 } from '../components/icons';
import { useEffect, useRef, useState } from 'react';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { Button, cx } from '../components/ui';
import { diffAnswer, judgeAnswer } from '../lib/diff';
import { haptic, isPhoneApp } from '../lib/platform';
import { speak } from '../lib/tts';
import { GameShell, Results, saveBest, sentencePool, shuffle, StartScreen, useBest } from './shared';
import { tr } from '../lib/i18n';

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
      <GameShell title={tr('Diktat')}>
        <StartScreen game="diktat" title={tr('Diktat')} onStart={() => void start()} best={best} bestLabel={`/${ROUNDS}`}>{tr('Hör einen Satz – aus deinen eigenen Karten, sobald du genug hast – und schreib ihn auf. Großschreibung, Umlaute und ß zählen.')}</StartScreen>
      </GameShell>
    );
  if (phase === 'done')
    return (
      <GameShell title={tr('Diktat')}>
        <Results score={score} total={ROUNDS} prevBest={prevBest} onAgain={() => void start()} />
      </GameShell>
    );
  if (!item) return null;
  const diff = verdict ? diffAnswer(text.trim(), item.de) : null;

  return (
    <GameShell title={tr('Diktat')} right={`${round + 1}/${ROUNDS}`} progress={(round + (verdict ? 1 : 0)) / ROUNDS}>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex gap-3">
          <Button className="size-20 rounded-full bg-krake-soft !px-0 text-krake-deep hover:bg-krake-soft hover:brightness-95" onClick={() => play()} aria-label={tr('Anhören')}>
            <Volume2 className="size-8" />
          </Button>
          <Button className="size-20 rounded-full !px-0" onClick={() => play(0.6)} aria-label={tr('Langsam anhören')}>
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
            placeholder={tr('Schreib, was du hörst …')}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            lang="de"
            className={cx(
              'h-14 w-full rounded-md border-2 bg-paper-raised px-4 font-display text-[20px] font-semibold outline-none',
              !verdict ? 'border-line field-focus' : verdict === 'exact' ? 'border-wiese' : verdict === 'close' ? 'border-sonne-ink' : 'border-koralle-ink',
            )}
          />
          {!isPhoneApp && !verdict && <UmlautBar className="mt-2" onInsert={(ch) => insertAtCaret(ref.current, ch, setText)} />}
          {diff && (
            <div className="anim-in mt-4 space-y-2 rounded-md bg-paper-raised px-4 py-3">
              <div className="font-mono text-[15px] leading-relaxed">
                {diff.expected.map((s, i) => (
                  <span key={i} className={cx(s.kind === 'ok' ? 'text-wiese' : 'text-ink underline decoration-sonne decoration-[3px] underline-offset-4')}>
                    {s.text}
                  </span>
                ))}
              </div>
              <div className="t-caption text-ink-muted">{item.en}</div>
              <div className={cx('text-[15px] font-bold', verdict === 'exact' ? 'text-wiese' : verdict === 'close' ? 'text-sonne-ink' : 'text-koralle-ink')}>
                {verdict === 'exact' ? tr('Perfekt!') : verdict === 'close' ? tr('Fast – nur Großschreibung, Umlaute oder Satzzeichen weichen ab.') : tr('Unterstrichen: was gefehlt hat oder anders war.')}
              </div>
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" className="mt-4 w-full">
            {!verdict ? tr('Prüfen') : round + 1 >= ROUNDS ? tr('Fertig') : tr('Weiter')}
          </Button>
        </form>
      </div>
    </GameShell>
  );
}
