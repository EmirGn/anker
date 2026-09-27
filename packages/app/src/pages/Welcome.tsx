import { STARTER_DECKS, type Prefs } from '@anker/core';
import { ArrowRight, Check, Laptop, Sparkles } from '../components/icons';
import { useEffect, useState } from 'react';
import { DeckCover } from '../components/DeckCover';
import { OttoBadge } from '../components/Otto';
import { Button, cx, Input, Label, Select, toast } from '../components/ui';
import { setMeta } from '../lib/db';
import { useHub, usePrefs } from '../lib/hooks';
import { isDesktop } from '../lib/platform';
import { savePrefs } from '../lib/repo';
import { navigate } from '../lib/router';
import { STARTER_DE } from '../lib/de';
import { installStarterDecks } from '../lib/starter';

const LEVELS: { id: Prefs['level']; label: string }[] = [
  { id: 'A1', label: 'Anfänger' },
  { id: 'A2', label: 'Grundlagen' },
  { id: 'B1', label: 'Mittelstufe' },
  { id: 'B2', label: 'Gute Mittelstufe' },
  { id: 'C1', label: 'Fortgeschritten' },
  { id: 'C2', label: 'Sehr gut' },
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
  useEffect(() => {
    if (prefs.updatedAt) {
      setName((n) => n || prefs.name || '');
      setLevel(prefs.level);
      setLang(prefs.nativeLanguage);
    }
  }, [prefs.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    setBusy(true);
    try {
      await savePrefs({ name: name.trim() || undefined, level, nativeLanguage: lang });
      const n = picked.size ? await installStarterDecks([...picked]) : 0;
      await setMeta('onboarded', true);
      if (n) toast.success(`${n} Notizen hinzugefügt. Viel Spaß!`);
      navigate('/', { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    <div key="0" className="text-center">
      <OttoBadge size={168} mood="happy" className="mx-auto mb-8" />
      <h1 className="t-hero">Willkommen bei Anker.</h1>
      <p className="t-body-lg mx-auto mt-3 max-w-md text-ink-muted">
        Deutsch, jeden Tag ein bisschen. Otto hält deine Wörter fest wie ein Anker – mit einem Tutor, der über dein eigenes Claude- oder ChatGPT-Abo läuft.
      </p>
      <Button variant="primary" size="lg" className="mt-10 w-full" onClick={() => setStep(1)}>
        Los geht’s <ArrowRight className="size-5" />
      </Button>
      {!hub && !isDesktop && (
        <button onClick={() => navigate('/connect')} className="t-label mt-3 block h-11 w-full text-ink-muted hover:text-ink">
          Ich nutze Anker schon auf meinem Mac → verbinden
        </button>
      )}
    </div>,
    <div key="1">
      <div className="t-overline text-ink-muted">Schritt 1 von 2</div>
      <h2 className="t-title mt-1.5">Über dich</h2>
      <p className="mt-1.5 text-[15px] text-ink-muted">Damit Beispiele und Erklärungen zu dir passen.</p>
      <div className="mt-6 space-y-5">
        <div>
          <Label>Wie soll ich dich nennen?</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dein Name (optional)" autoFocus />
        </div>
        <div>
          <Label>Dein Deutschniveau</Label>
          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLevel(l.id)}
                className={cx('min-h-14 rounded-md border px-3 py-2 text-left transition-colors duration-[120ms]', level === l.id ? 'border-hafen bg-hafen-soft' : 'border-line bg-paper-raised hover:bg-paper-sunk')}
              >
                <div className={cx('t-label', level === l.id && 'text-hafen')}>{l.id}</div>
                <div className="t-caption text-ink-muted">{l.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Erklärungen auf</Label>
          <Select value={lang} onChange={(e) => setLang(e.target.value)}>
            {['English', 'Türkçe', 'Español', 'Français', 'Italiano', 'Português', 'Polski', 'Русский', 'Українська', 'العربية', 'فارسی', '中文', '日本語', 'Deutsch'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={() => setStep(0)}>
          Zurück
        </Button>
        <Button variant="primary" size="lg" onClick={() => setStep(2)}>
          Weiter <ArrowRight className="size-5" />
        </Button>
      </div>
    </div>,
    <div key="2">
      <div className="t-overline text-ink-muted">Schritt 2 von 2</div>
      <h2 className="t-title mt-1.5">Deine Starter-Decks</h2>
      <p className="mt-1.5 text-[15px] text-ink-muted">Handgemacht für Anker. Du kannst später alles ändern oder löschen.</p>
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
              className={cx('flex w-full items-center gap-4 rounded-md border p-3 text-left transition-colors duration-[120ms]', on ? 'border-hafen bg-hafen-soft' : 'border-line bg-paper-raised hover:bg-paper-sunk')}
            >
              <DeckCover deck={{ id: d.key, name: d.path.split('::').pop()! }} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="t-label">{d.title}</span>
                  <span className="t-caption text-ink-muted">
                    {d.count} Notizen · {d.level}
                  </span>
                </span>
                <span className="t-caption mt-1 block text-ink-muted">{STARTER_DE[d.key] ?? d.description}</span>
              </span>
              <span className={cx('mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-hafen bg-hafen text-on-hafen' : 'border-line')}>
                {on && <Check weight="bold" className="size-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="t-caption mt-5 flex items-start gap-3 rounded-md bg-paper-sunk px-4 py-3 text-ink-muted">
        {isDesktop ? <Sparkles className="size-5 shrink-0 text-ink" /> : <Laptop className="size-5 shrink-0 text-ink" />}
        {isDesktop
          ? 'Tipp: Melde dich unter Einstellungen → KI-Tutor bei Claude oder Codex an und lass dir Decks zu jedem Thema bauen.'
          : 'Tipp: Verbinde dich mit der Anker-App auf deinem Mac (Einstellungen → Sync), um deinen Fortschritt zu synchronisieren und den KI-Tutor zu nutzen.'}
      </div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={() => setStep(1)}>
          Zurück
        </Button>
        <Button variant="primary" size="lg" loading={busy} onClick={finish}>
          {picked.size ? 'Installieren & starten' : 'Leer starten'}
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
            <span key={i} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-hafen' : 'w-1.5 bg-line')} />
          ))}
        </div>
      </div>
    </div>
  );
}
