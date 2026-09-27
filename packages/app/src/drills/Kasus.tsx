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
        <StartScreen game="kasus" title="Kasus-Trainer" onStart={start} best={best} bestLabel={`/${ROUNDS}`}>
          mit, für, auf, wegen … Wähl den Artikel, der folgt. Bei Wechselpräpositionen zählt die Frage: <b>Wo?</b> → Dativ, <b>Wohin?</b> → Akkusativ.
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
            <span className={cx('inline-block rounded-full px-3 py-1 text-[13px] font-semibold', q.context === 'Wo?' ? 'bg-paper-sunk text-ink' : 'bg-sonne text-on-sonne')}>
              {q.context} {q.context === 'Wo?' ? '(Ort)' : '(Richtung)'}
            </span>
          )}
          <div className="t-title md:text-[44px] md:leading-[46px]" lang="de">
            {q.prep.word}{' '}
            <span className={cx('inline-block min-w-20 rounded-md border-b-4 px-2', !picked ? 'border-hafen text-ink-muted' : ok ? 'border-wiese text-wiese' : 'border-koralle-ink text-koralle-ink')}>
              {picked ? q.answer : '___'}
            </span>{' '}
            {q.word}
          </div>
          <div className="text-[15px] text-ink-muted">
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
                'h-14 rounded-md border text-[20px] font-semibold transition-colors',
                !picked && 'border-line bg-paper-raised hover:bg-paper-sunk',
                picked && o === q.answer && 'border-wiese bg-wiese-soft text-wiese',
                picked === o && o !== q.answer && 'anim-shake border-koralle-ink bg-koralle-soft text-koralle-ink',
                picked && o !== q.answer && picked !== o && 'border-line opacity-40',
              )}
            >
              {o}
              <span className="ml-1.5 text-[11px] font-medium text-ink-muted">{i + 1}</span>
            </button>
          ))}
        </div>
        {picked && (
          <div className="anim-in w-full max-w-md space-y-3">
            <div className="rounded-md bg-paper-raised px-4 py-3 text-[15px]">
              <b>{q.prep.word}</b> + {q.prep.case === 'wechsel' ? `${q.context} → ` : ''}
              <b>{CASE_NAME[q.kase]}</b>: {GENDER_ARTICLE[q.gender]} → <b>{q.answer}</b>
              {contracted && (
                <span className="text-ink-muted">
                  {' '}
                  · meist verkürzt: <b>{contracted}</b>
                </span>
              )}
              {q.kase === 'dat' && q.gender === 'pl' && <div className="mt-1 text-[13px] text-ink-muted">Dativ Plural: Das Nomen bekommt auch ein -n (außer es endet schon auf -n oder -s).</div>}
              {q.kase === 'gen' && (q.gender === 'der' || q.gender === 'das') && <div className="mt-1 text-[13px] text-ink-muted">Genitiv: Maskuline und neutrale Nomen bekommen -(e)s, z. B. des Wetters.</div>}
            </div>
            <Button variant="primary" size="lg" className="w-full" onClick={next} autoFocus>
              {round + 1 >= ROUNDS ? 'Fertig' : 'Weiter'}
            </Button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
