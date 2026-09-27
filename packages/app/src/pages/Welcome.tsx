import { STARTER_DECKS, type Prefs } from '@anker/core';
import { ArrowRight, Check, Laptop, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '../components/Logo';
import { Button, cx, Input, Label, Select, toast } from '../components/ui';
import { setMeta } from '../lib/db';
import { useHub, usePrefs } from '../lib/hooks';
import { isDesktop } from '../lib/platform';
import { savePrefs } from '../lib/repo';
import { navigate } from '../lib/router';
import { installStarterDecks } from '../lib/starter';

const LEVELS: { id: Prefs['level']; label: string }[] = [
  { id: 'A1', label: 'Beginner' },
  { id: 'A2', label: 'Elementary' },
  { id: 'B1', label: 'Intermediate' },
  { id: 'B2', label: 'Upper-int.' },
  { id: 'C1', label: 'Advanced' },
  { id: 'C2', label: 'Proficient' },
];

export function Welcome() {
  const prefs = usePrefs();
  const hub = useHub();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(prefs.name ?? '');
  const [level, setLevel] = useState<Prefs['level']>(prefs.level);
  const [lang, setLang] = useState(prefs.nativeLanguage);
  const [picked, setPicked] = useState<Set<string>>(new Set(['a1', 'faelle', 'redemittel', 'verben']));
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      await savePrefs({ name: name.trim() || undefined, level, nativeLanguage: lang });
      const n = picked.size ? await installStarterDecks([...picked]) : 0;
      await setMeta('onboarded', true);
      if (n) toast.success(`Added ${n} notes — viel Spaß!`);
      navigate('/', { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    <div key="0" className="text-center">
      <div className="mx-auto mb-6 w-fit">
        <Logo size={88} />
      </div>
      <h1 className="font-display text-[40px] leading-tight font-semibold tracking-tight">Willkommen bei Anker</h1>
      <p className="mx-auto mt-3 max-w-md text-[16px] leading-relaxed text-muted">
        Your spaced-repetition home for German. Anker — German for <i>anchor</i> — keeps words firmly in your memory, with a tutor powered by your own Claude and ChatGPT subscriptions.
      </p>
      <Button variant="primary" size="lg" className="mt-8" onClick={() => setStep(1)}>
        Los geht's <ArrowRight className="size-5" />
      </Button>
      {!hub && !isDesktop && (
        <button onClick={() => navigate('/connect')} className="mt-4 block w-full text-sm font-medium text-muted hover:text-ink">
          I already use Anker on my Mac → connect
        </button>
      )}
    </div>,
    <div key="1">
      <h2 className="font-display text-[30px] font-semibold">About you</h2>
      <p className="mt-1 text-muted">So examples and explanations fit you.</p>
      <div className="mt-6 space-y-5">
        <div>
          <Label>What should I call you?</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" autoFocus />
        </div>
        <div>
          <Label>Your German level</Label>
          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLevel(l.id)}
                className={cx('rounded-2xl border px-3 py-2.5 text-left transition-colors', level === l.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
              >
                <div className="font-semibold">{l.id}</div>
                <div className="text-[12px] text-muted">{l.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Explanations in</Label>
          <Select value={lang} onChange={(e) => setLang(e.target.value)}>
            {['English', 'Türkçe', 'Español', 'Français', 'Italiano', 'Português', 'Polski', 'Русский', 'Українська', 'العربية', 'فارسی', '中文', '日本語', 'Deutsch'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={() => setStep(0)}>
          Back
        </Button>
        <Button variant="primary" onClick={() => setStep(2)}>
          Next <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>,
    <div key="2">
      <h2 className="font-display text-[30px] font-semibold">Pick your starter decks</h2>
      <p className="mt-1 text-muted">Hand-made for Anker. You can delete or edit anything later.</p>
      <div className="mt-6 space-y-2.5">
        {STARTER_DECKS.map((d) => {
          const on = picked.has(d.key);
          return (
            <button
              key={d.key}
              onClick={() => {
                const next = new Set(picked);
                if (on) next.delete(d.key);
                else next.add(d.key);
                setPicked(next);
              }}
              className={cx('flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
            >
              <span className="text-2xl">{d.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{d.title}</span>
                  <span className="text-[12px] text-faint">
                    {d.count} notes · {d.level}
                  </span>
                </span>
                <span className="mt-0.5 block text-[13.5px] text-muted">{d.description}</span>
              </span>
              <span className={cx('mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-accent bg-accent text-accent-ink' : 'border-line')}>
                {on && <Check className="size-4" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-surface-2/70 px-4 py-3 text-[13.5px] text-muted">
        {isDesktop ? <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" /> : <Laptop className="mt-0.5 size-4 shrink-0 text-accent" />}
        {isDesktop
          ? 'Tip: sign in to Claude or Codex in Settings → AI tutor, then ask it to build decks about anything you like.'
          : 'Tip: connect to the Anker app on your Mac (Settings → Sync) to sync your progress and unlock the AI tutor.'}
      </div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={() => setStep(1)}>
          Back
        </Button>
        <Button variant="primary" size="lg" loading={busy} onClick={finish}>
          {picked.size ? 'Install & start' : 'Start empty'}
        </Button>
      </div>
    </div>,
  ];

  return (
    <div className="pt-safe flex min-h-full items-center justify-center px-5 py-10">
      <div key={step} className="anim-in w-full max-w-lg">
        {steps[step]}
        <div className="mt-10 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-accent' : 'w-1.5 bg-surface-3')} />
          ))}
        </div>
      </div>
    </div>
  );
}
