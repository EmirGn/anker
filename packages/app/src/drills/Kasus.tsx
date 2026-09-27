import { CASE_NAME, CONTRACTIONS, DEFINITE, GENDER_ARTICLE, PREPOSITIONS, type Case, type Gender, type Preposition } from '@anker/core';
import { useEffect, useState } from 'react';
import { GENDER_VAR } from '../components/CardView';
import { Button, cx } from '../components/ui';
import { useHotkeys } from '../lib/hooks';
import { haptic } from '../lib/platform';
import { speak } from '../lib/tts';
import { GameShell, nounPool, pick, recordItem, Results, saveBest, StartScreen, useBest } from './shared';

const ROUNDS = 15;
const OPTIONS = ['der', 'die', 'das', 'den', 'dem', 'des'];

interface Q {
  prep: Preposition;
  word: string;
  gender: Gender;
  kase: Exclude<Case, 'nom'>;
  context: 'Wo?' | 'Wohin?' | null;
  answer: string;
}

function makeQuestion(nouns: { word: string; gender: Gender; plural: string }[]): Q {
  const r = Math.random();
  const group = r < 0.25 ? 'akk' : r < 0.6 ? 'dat' : r < 0.9 ? 'wechsel' : 'gen';
  const prep = pick(PREPOSITIONS.filter((p) => p.case === group));
  const usePlural = Math.random() < 0.15;
  const candidates = nouns.filter((n) => (usePlural ? n.plural && n.plural !== '-' : n.gender !== 'pl'));
  const n = pick(candidates.length ? candidates : nouns);
  const plural = usePlural && n.plural && n.plural !== '-';
  const gender: Gender = plural ? 'pl' : n.gender;
  const word = plural ? n.plural : n.word;
  let kase: Exclude<Case, 'nom'>;
  let context: Q['context'] = null;
  if (prep.case === 'wechsel') {
    context = Math.random() < 0.5 ? 'Wo?' : 'Wohin?';
    kase = context === 'Wo?' ? 'dat' : 'akk';
  } else kase = prep.case;
  return { prep, word, gender, kase, context, answer: DEFINITE[kase][gender] };
}

export function Kasus() {
  const best = useBest('kasus');
  const [nouns, setNouns] = useState<{ word: string; gender: Gender; plural: string }[]>([]);
  const [phase, setPhase] = useState<'start' | 'play' | 'done'>('start');
  const [round, setRound] = useState(0);
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [prevBest, setPrevBest] = useState<number | null>(null);

  useEffect(() => {
    void nounPool().then((p) => setNouns(p.filter((n) => n.gender)));
  }, []);

  const start = () => {
    setScore(0);
    setRound(0);
    setPicked(null);
    setQ(makeQuestion(nouns));
    setPhase('play');
  };

  const choose = (a: string) => {
    if (!q || picked) return;
    setPicked(a);
    const ok = a === q.answer;
    if (ok) setScore((s) => s + 1);
    void recordItem('kasus', `${q.prep.word}:${q.kase}`, ok);
    void haptic(ok ? 'success' : 'error');
    const contracted = CONTRACTIONS[`${q.prep.word} ${q.answer}`];
    void speak(`${contracted ?? `${q.prep.word} ${q.answer}`} ${q.word}`);
  };

  const next = () => {
    if (round + 1 >= ROUNDS) setPhase('done');
    else {
      setRound((r) => r + 1);
      setPicked(null);
      setQ(makeQuestion(nouns));
    }
  };

  useHotkeys(
    Object.fromEntries([
      ...OPTIONS.map((o, i) => [String(i + 1), () => choose(o)]),
      ['enter', () => (phase === 'play' && picked ? next() : phase !== 'play' ? start() : undefined)],
    ]),
    [q, picked, phase, nouns],
  );

  useEffect(() => {
    if (phase === 'done') void saveBest('kasus', score).then(setPrevBest);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'start')
    return (
      <GameShell title="Kasus-Trainer">
        <StartScreen emoji="🎯" title="Kasus-Trainer" onStart={start} best={best} bestLabel={`/${ROUNDS}`}>
          mit, für, auf, wegen… Pick the article that follows. For Wechselpräpositionen watch the question: <b>Wo?</b> → Dativ, <b>Wohin?</b> → Akkusativ.
        </StartScreen>
      </GameShell>
    );
  if (phase === 'done')
    return (
      <GameShell title="Kasus-Trainer">
        <Results score={score} total={ROUNDS} prevBest={prevBest} onAgain={start} />
      </GameShell>
    );
  if (!q) return null;

  const ok = picked === q.answer;
  const contracted = CONTRACTIONS[`${q.prep.word} ${q.answer}`];
  return (
    <GameShell title="Kasus-Trainer" right={`${round + 1}/${ROUNDS}`} progress={(round + (picked ? 1 : 0)) / ROUNDS}>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <div className="space-y-3">
          {q.context && (
            <span className={cx('inline-block rounded-full px-3 py-1 text-[13px] font-semibold', q.context === 'Wo?' ? 'bg-easy/12 text-easy' : 'bg-hard/15 text-hard')}>
              {q.context} {q.context === 'Wo?' ? '(position)' : '(direction)'}
            </span>
          )}
          <div className="font-display text-[38px] leading-tight font-semibold md:text-[46px]">
            {q.prep.word}{' '}
            <span className={cx('inline-block min-w-20 rounded-xl border-b-4 px-2', !picked ? 'border-accent text-faint' : ok ? 'border-good text-good' : 'border-again text-again')}>
              {picked ? q.answer : '___'}
            </span>{' '}
            {q.word}
          </div>
          <div className="text-[15px] text-muted">
            ({GENDER_ARTICLE[q.gender]} <span style={{ color: GENDER_VAR[q.gender] }}>{q.word}</span>
            {q.gender === 'pl' ? ', Plural' : ''}) · {q.prep.meaning}
          </div>
        </div>
        <div className="grid w-full max-w-md grid-cols-3 gap-2">
          {OPTIONS.map((o, i) => (
            <button
              key={o}
              onClick={() => choose(o)}
              className={cx(
                'h-14 rounded-2xl border text-[19px] font-semibold transition-colors',
                !picked && 'border-line bg-surface hover:bg-surface-2',
                picked && o === q.answer && 'border-good bg-good/12 text-good',
                picked === o && o !== q.answer && 'anim-shake border-again bg-again/10 text-again',
                picked && o !== q.answer && picked !== o && 'border-line opacity-40',
              )}
            >
              {o}
              <span className="ml-1.5 text-[11px] font-medium text-faint">{i + 1}</span>
            </button>
          ))}
        </div>
        {picked && (
          <div className="anim-in w-full max-w-md space-y-3">
            <div className="rounded-2xl bg-surface-2 px-4 py-3 text-[14.5px]">
              <b>{q.prep.word}</b> + {q.prep.case === 'wechsel' ? `${q.context} → ` : ''}
              <b>{CASE_NAME[q.kase]}</b>: {GENDER_ARTICLE[q.gender]} → <b>{q.answer}</b>
              {contracted && (
                <span className="text-muted">
                  {' '}
                  · usually contracted: <b>{contracted}</b>
                </span>
              )}
              {q.kase === 'dat' && q.gender === 'pl' && <div className="mt-1 text-[13px] text-muted">Dativ plural: the noun also gets -n (unless it already ends in -n or -s).</div>}
              {q.kase === 'gen' && (q.gender === 'der' || q.gender === 'das') && <div className="mt-1 text-[13px] text-muted">Genitiv: masculine/neuter nouns add -(e)s, e.g. des Wetters.</div>}
            </div>
            <Button variant="primary" size="lg" className="w-full" onClick={next} autoFocus>
              {round + 1 >= ROUNDS ? 'Finish' : 'Next'}
            </Button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
