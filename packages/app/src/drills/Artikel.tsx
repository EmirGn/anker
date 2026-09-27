import { type Gender, type PoolNoun } from '@anker/core';
import { erklaereGenus } from '../lib/de';
import { Flame, Plus } from '../components/icons';
import { useEffect, useRef, useState } from 'react';
import { GENDER_VAR } from '../components/CardView';
import { Button, cx, toast } from '../components/ui';
import { useHotkeys } from '../lib/hooks';
import { haptic } from '../lib/platform';
import { addNotes, createDeckPath } from '../lib/repo';
import { speak } from '../lib/tts';
import { GameShell, missedItems, nounPool, recordItem, Results, saveBest, shuffle, StartScreen, useBest } from './shared';

const DURATION = 60_000;
const OPTIONS: Exclude<Gender, 'pl'>[] = ['der', 'die', 'das'];

type Phase = 'start' | 'play' | 'done';
type Noun = PoolNoun & { own: boolean };

export function ArtikelBlitz() {
  const best = useBest('artikel');
  const [phase, setPhase] = useState<Phase>('start');
  const [queue, setQueue] = useState<Noun[]>([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [missed, setMissed] = useState<Noun[]>([]);
  const [feedback, setFeedback] = useState<{ ok: boolean; gender: Gender; hint: string | null } | null>(null);
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [prevBest, setPrevBest] = useState<number | null>(null);
  const [showMeaning, setShowMeaning] = useState(false);
  const locked = useRef(false);

  const start = async () => {
    const pool = (await nounPool()).filter((n) => n.gender !== 'pl');
    const weak = await missedItems('artikel');
    const weakFirst = shuffle(pool.filter((n) => weak.has(n.word)));
    const rest = shuffle(pool.filter((n) => !weak.has(n.word)));
    const mixed: Noun[] = [];
    while (weakFirst.length || rest.length) {
      if (weakFirst.length && (Math.random() < 0.35 || !rest.length)) mixed.push(weakFirst.shift()!);
      else mixed.push(rest.shift()!);
    }
    setQueue(mixed);
    setIdx(0);
    setScore(0);
    setStreak(0);
    setAnswered(0);
    setMissed([]);
    setFeedback(null);
    setEndsAt(Date.now() + DURATION);
    setPhase('play');
  };

  useEffect(() => {
    if (phase !== 'play') return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= endsAt) {
        clearInterval(t);
        setPhase('done');
      }
    }, 100);
    return () => clearInterval(t);
  }, [phase, endsAt]);

  useEffect(() => {
    if (phase === 'done') void saveBest('artikel', score).then(setPrevBest);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const noun = queue[idx % Math.max(1, queue.length)];

  const answer = (g: Exclude<Gender, 'pl'>) => {
    if (phase !== 'play' || !noun || locked.current) return;
    const ok = g === noun.gender;
    void recordItem('artikel', noun.word, ok);
    setAnswered((a) => a + 1);
    if (ok) {
      setScore((s) => s + 1);
      setStreak((s) => s + 1);
      void haptic('tap');
      setFeedback({ ok: true, gender: noun.gender, hint: null });
      locked.current = true;
      setTimeout(() => {
        locked.current = false;
        setFeedback(null);
        setIdx((i) => i + 1);
      }, 260);
    } else {
      setStreak(0);
      void haptic('error');
      setMissed((m) => (m.some((x) => x.word === noun.word) ? m : [...m, noun]));
      setFeedback({ ok: false, gender: noun.gender, hint: erklaereGenus(noun.word, noun.gender) });
      void speak(`${noun.gender} ${noun.word}`);
      locked.current = true;
      setTimeout(() => {
        locked.current = false;
        setFeedback(null);
        setIdx((i) => i + 1);
      }, 1600);
    }
  };

  useHotkeys(
    {
      '1': () => answer('der'),
      '2': () => answer('die'),
      '3': () => answer('das'),
      arrowleft: () => answer('der'),
      arrowdown: () => answer('die'),
      arrowright: () => answer('das'),
      enter: () => phase !== 'play' && void start(),
    },
    [phase, noun, locked],
  );

  const left = Math.max(0, endsAt - now);

  if (phase === 'start')
    return (
      <GameShell title="Artikel-Blitz">
        <StartScreen game="artikel" title="Artikel-Blitz" onStart={() => void start()} best={best}>
          60 Sekunden. Ein Nomen erscheint – tipp auf <b style={{ color: GENDER_VAR.der }}>der</b>, <b style={{ color: GENDER_VAR.die }}>die</b> oder <b style={{ color: GENDER_VAR.das }}>das</b>. Bei einem Fehler
          zeigt Otto dir die passende Regel. Tasten: 1 · 2 · 3.
        </StartScreen>
      </GameShell>
    );

  if (phase === 'done')
    return (
      <GameShell title="Artikel-Blitz">
        <Results score={score} prevBest={prevBest} onAgain={() => void start()}>
          <div className="mb-3 text-center text-[15px] text-ink-muted">
            {answered} beantwortet · {answered ? Math.round((score / answered) * 100) : 0} % richtig
          </div>
          {missed.length > 0 && (
            <div className="rounded-md border border-line bg-paper-raised p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="t-overline text-ink-muted">Verpasst</span>
                {missed.some((m) => !m.own) && (
                  <Button
                    size="sm"
                    icon={<Plus className="size-4" />}
                    onClick={async () => {
                      const deck = await createDeckPath('Deutsch::Artikel-Blitz');
                      const r = await addNotes(
                        missed.filter((m) => !m.own).map((m) => ({ deckId: deck.id, type: 'word' as const, fields: { german: m.word, gender: m.gender, plural: m.plural, english: m.meaning, pos: 'noun' }, tags: ['artikel-blitz'] })),
                      );
                      toast.success(`${r.added} Wörter zu „Artikel-Blitz“ hinzugefügt`);
                    }}
                  >
                    Als Karten speichern
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                {missed.map((m) => (
                  <div key={m.word} className="text-[15px]">
                    <b style={{ color: GENDER_VAR[m.gender] }}>{m.gender}</b> {m.word} <span className="text-ink-muted">– {m.meaning}</span>
                    {erklaereGenus(m.word, m.gender) && <div className="t-caption text-ink-muted">{erklaereGenus(m.word, m.gender)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Results>
      </GameShell>
    );

  return (
    <GameShell title="Artikel-Blitz" right={<span className={cx(left < 10_000 && 'text-koralle-ink')}>{Math.ceil(left / 1000)} s</span>} progress={1 - left / DURATION}>
      <div className="flex items-center justify-between text-[15px] font-semibold">
        <span>
          Punkte <span className="tabular-nums">{score}</span>
        </span>
        {streak >= 3 && (
          <span className="anim-in inline-flex h-7 items-center gap-1 rounded-full bg-sonne px-2.5 text-[13px] font-bold text-on-sonne">
            <Flame weight="fill" className="size-4" /> {streak} in Folge
          </span>
        )}
        <button onClick={() => setShowMeaning((v) => !v)} className="h-9 text-[13px] font-semibold text-ink-muted hover:text-ink">
          Bedeutung {showMeaning ? 'ausblenden' : 'zeigen'}
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center py-10">
        {noun && (
          <div key={idx} className={cx('anim-in text-center', feedback && !feedback.ok && 'anim-shake')}>
            <div className="t-word md:text-[64px] md:leading-[66px]" lang="de">
              {feedback && (
                <span className="anim-in" style={{ color: GENDER_VAR[feedback.gender] }}>
                  {feedback.gender}{' '}
                </span>
              )}
              {noun.word}
            </div>
            {(showMeaning || feedback) && <div className="mt-2 text-[17px] text-ink-muted">{noun.meaning}</div>}
            {feedback?.hint && <div className="t-caption mx-auto mt-4 max-w-sm rounded-md bg-paper-raised px-4 py-2.5 text-ink-muted">{feedback.hint}</div>}
          </div>
        )}
      </div>
      <div className="pb-safe grid grid-cols-3 gap-3">
        {OPTIONS.map((g, i) => (
          <button
            key={g}
            onClick={() => answer(g)}
            className={cx(
              'h-20 rounded-md border bg-paper-raised text-[28px] font-bold transition-transform duration-[120ms] active:scale-95 md:h-24',
              feedback?.ok && feedback.gender === g ? 'border-wiese ring-2 ring-wiese' : 'border-line hover:bg-paper-sunk',
            )}
            style={{ color: GENDER_VAR[g] }}
          >
            {g}
            <span className="ml-2 hidden text-[13px] font-medium text-ink-muted md:inline">{i + 1}</span>
          </button>
        ))}
      </div>
    </GameShell>
  );
}
