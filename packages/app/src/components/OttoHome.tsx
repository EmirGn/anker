// Otto on the home screen: he greets you with something personal, you can ask
// him anything or start talking right there, and he suggests what to do next.
import { useState } from 'react';
import { useHub } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { ottoLine, ottoSuggestions, useOttoData, type OttoActivity, type OttoSuggestion } from '../lib/otto';
import { navigate } from '../lib/router';
import { ArrowUp, MessagesSquare, Mic, Sparkles } from './icons';
import { OttoBadge } from './Otto';
import { Button, cx } from './ui';
import { useVoiceLauncher } from './VoiceChat';

/** Ask Otto in a new chat (the Otto page sends it straight away). */
export const askOtto = (q: string) => navigate(`/otto?go=1&q=${encodeURIComponent(q)}`);

export function runSuggestion(s: OttoSuggestion, talk: (a: OttoActivity) => void) {
  if (s.kind === 'talk') talk(s.activity);
  else if (s.kind === 'open') navigate(`/otto/${s.chatId}`);
  else askOtto(s.prompt);
}

export function SuggestionIcon({ s, className }: { s: OttoSuggestion; className?: string }) {
  if (s.kind === 'talk') return <Mic className={cx('shrink-0 text-hafen', className)} />;
  if (s.kind === 'open') return <MessagesSquare className={cx('shrink-0 text-ink-muted', className)} />;
  return <Sparkles className={cx('shrink-0 text-krake-deep', className)} />;
}

export function OttoHome({ due }: { due: number }) {
  const hub = useHub();
  const data = useOttoData();
  const voice = useVoiceLauncher();
  const [text, setText] = useState('');

  if (!hub) {
    return (
      <section className="flex flex-col items-start gap-4 rounded-md border border-line bg-paper-raised p-4 sm:flex-row sm:items-center md:p-5">
        <OttoBadge size={56} mood="sleepy" />
        <div className="min-w-0 flex-1">
          <div className="t-label">{tr('Otto wohnt auf deinem Mac')}</div>
          <p className="t-caption mt-0.5 text-ink-muted">{tr('Verbinde dieses Gerät mit Anker auf deinem Mac, dann kannst du mit Otto schreiben und sprechen und deine Decks synchronisieren.')}</p>
        </div>
        <Button onClick={() => navigate('/connect')}>{tr('Verbinden')}</Button>
      </section>
    );
  }

  const suggestions = data ? ottoSuggestions(data, 3) : [];
  return (
    <section className="rounded-md border border-line bg-paper-raised p-4 md:p-5">
      <div className="flex items-start gap-3">
        <OttoBadge size={52} mood="happy" />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="t-label">Otto</div>
          <p className="t-body-lg mt-0.5 text-ink">{data ? ottoLine(data, due) : '…'}</p>
        </div>
      </div>

      <form
        className="field-focus mt-4 flex items-center gap-1.5 rounded-md border border-transparent bg-paper-sunk py-1.5 pr-1.5 pl-4 transition-[border,background,box-shadow] duration-[120ms]"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) askOtto(text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr('Frag Otto etwas …')}
          aria-label={tr('Frag Otto etwas')}
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-muted"
        />
        <button
          type="button"
          onClick={() => voice.open()}
          title={tr('Mit Otto sprechen')}
          aria-label={tr('Mit Otto sprechen')}
          className="flex h-10 items-center gap-1.5 rounded-md bg-krake-soft px-3 text-[15px] font-semibold text-krake-deep transition-[filter] duration-[120ms] hover:brightness-95"
        >
          <Mic className="size-5" />
          <span className="hidden sm:inline">{tr('Sprechen')}</span>
        </button>
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label={tr('Fragen')}
          className="flex size-10 items-center justify-center rounded-md bg-hafen text-on-hafen transition-opacity disabled:opacity-35"
        >
          <ArrowUp className="size-5" />
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => runSuggestion(s, voice.open)}
              className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-left text-[13px] font-semibold text-ink transition-colors duration-[120ms] hover:bg-paper-sunk"
            >
              <SuggestionIcon s={s} className="size-4" />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      {voice.element}
    </section>
  );
}
