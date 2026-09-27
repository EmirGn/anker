import { parseVerbForms, type PoolVerb } from '@anker/core';
import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { Button, cx } from '../components/ui';
import { judgeAnswer } from '../lib/diff';
import { haptic, isNative } from '../lib/platform';
import { speak } from '../lib/tts';
import { GameShell, missedItems, recordItem, Results, saveBest, shuffle, StartScreen, useBest, verbPool } from './shared';

const ROUNDS = 8;
const LABELS = ['er / sie / es … (Präsens)', 'Präteritum (er …)', 'Perfekt (er …)'];
const PLACEHOLDERS = ['fährt', 'fuhr', 'ist gefahren'];

const stripPronoun = (s: string) => s.trim().replace(/^(er|sie|es)\s+/i, '');

export function Verben() {
  const best = useBest('verben');
  const [phase, setPhase] = useState<'start' | 'play' | 'done'>('start');
  const [verbs, setVerbs] = useState<PoolVerb[]>([]);
  const [round, setRound] = useState(0);
  const [inputs, setInputs] = useState(['', '', '']);
  const [result, setResult] = useState<boolean[] | null>(null);
  const [score, setScore] = useState(0);
  const [prevBest, setPrevBest] = useState<number | null>(null);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const focused = useRef(0);

  const start = async () => {
    const pool = await verbPool();
    const weak = await missedItems('verben');
    const strong = pool.filter((v) => {
      const f = parseVerbForms(v.forms);
      return f.preterite && !/te$/.test(f.preterite);
    });
    const ordered = [...shuffle(pool.filter((v) => weak.has(v.infinitive))), ...shuffle(strong), ...shuffle(pool)];
    const seen = new Set<string>();
    setVerbs(ordered.filter((v) => !seen.has(v.infinitive) && seen.add(v.infinitive)).slice(0, ROUNDS));
    setRound(0);
    setScore(0);
    setInputs(['', '', '']);
    setResult(null);
    setPhase('play');
    setTimeout(() => refs[0]!.current?.focus(), 100);
  };

  const verb = verbs[round];
  const forms = verb ? parseVerbForms(verb.forms) : null;
  const expected = forms ? [forms.present3 ?? '', forms.preterite ?? '', forms.perfect ?? ''] : ['', '', ''];

  const check = () => {
    if (!verb) return;
    if (result) {
      if (round + 1 >= ROUNDS) setPhase('done');
      else {
        setRound((r) => r + 1);
        setInputs(['', '', '']);
        setResult(null);
        setTimeout(() => refs[0]!.current?.focus(), 50);
      }
      return;
    }
    const res = expected.map((e, i) => judgeAnswer(stripPronoun(inputs[i]!), e) !== 'wrong');
    setResult(res);
    const pts = res.filter(Boolean).length;
    setScore((s) => s + pts);
    void recordItem('verben', verb.infinitive, pts === 3);
    void haptic(pts === 3 ? 'success' : 'warning');
    void speak(`${verb.infinitive}, ${expected.join(', ')}`);
  };

  useEffect(() => {
    if (phase === 'done') void saveBest('verben', score).then(setPrevBest);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'start')
    return (
      <GameShell title="Stammformen">
        <StartScreen emoji="💪" title="Stammformen" onStart={() => void start()} best={best} bestLabel={`/${ROUNDS * 3}`}>
          The three forms every verb needs: <i>fahren → fährt · fuhr · ist gefahren</i>. Don't forget <b>haben</b> or <b>sein</b> in the Perfekt!
        </StartScreen>
      </GameShell>
    );
  if (phase === 'done')
    return (
      <GameShell title="Stammformen">
        <Results score={score} total={ROUNDS * 3} prevBest={prevBest} onAgain={() => void start()} />
      </GameShell>
    );
  if (!verb) return null;

  return (
    <GameShell title="Stammformen" right={`${round + 1}/${ROUNDS}`} progress={(round + (result ? 1 : 0)) / ROUNDS}>
      <div className="flex flex-1 flex-col items-center justify-center gap-7">
        <div className="text-center">
          <div className="font-display text-[46px] leading-tight font-semibold">{verb.infinitive}</div>
          <div className="text-[16px] text-muted">{verb.meaning}</div>
        </div>
        <form
          className="w-full max-w-md space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          {LABELS.map((label, i) => (
            <div key={label}>
              <div className="mb-1 text-[12.5px] font-medium text-muted">{label}</div>
              <div className="relative">
                <input
                  ref={refs[i]}
                  value={inputs[i]}
                  onFocus={() => (focused.current = i)}
                  onChange={(e) => setInputs((v) => Object.assign([...v], { [i]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && i < 2 && !result) {
                      e.preventDefault();
                      refs[i + 1]!.current?.focus();
                    }
                  }}
                  readOnly={!!result}
                  placeholder={PLACEHOLDERS[i]}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  lang="de"
                  className={cx(
                    'h-12 w-full rounded-xl border-2 bg-surface px-4 pr-10 text-[18px] outline-none',
                    !result ? 'border-line focus:border-accent' : result[i] ? 'border-good' : 'border-again',
                  )}
                />
                {result && (
                  <span className="absolute top-1/2 right-3 -translate-y-1/2">
                    {result[i] ? <Check className="size-5 text-good" /> : <X className="size-5 text-again" />}
                  </span>
                )}
              </div>
              {result && !result[i] && <div className="anim-in mt-1 text-[14px] font-semibold text-good">{expected[i]}</div>}
            </div>
          ))}
          {!isNative && !result && (
            <UmlautBar
              onInsert={(ch) => {
                const i = focused.current;
                insertAtCaret(refs[i]!.current, ch, (v) => setInputs((arr) => Object.assign([...arr], { [i]: v })));
              }}
            />
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full">
            {!result ? 'Check' : round + 1 >= ROUNDS ? 'Finish' : 'Next'}
          </Button>
        </form>
      </div>
    </GameShell>
  );
}
