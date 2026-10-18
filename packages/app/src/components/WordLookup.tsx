// Tap a word on the study card → a small popover with its base form, meaning,
// article/plural or verb forms, a speak button and "add to Gesammelt".
import {
  lookupInText,
  parseGender,
  parseVerbForms,
  pluralDisplay,
  sentenceAt,
  withArticle,
  entryFromAi,
  formatVerbForms,
  type DictEntry,
  type WordMatch,
} from '@anker/core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { aiLookup, cachedAiLookup, collectWord, findWordNote, getWordIndex, LookupUnavailable, GESAMMELT_DECK } from '../lib/lookup';
import { hub } from '../lib/hub';
import { tr } from '../lib/i18n';
import { CheckCircle2, Plus, Sparkles } from './icons';
import { GenderWord, POS_LABEL, SpeakButton } from './CardView';
import { Button, cx, Spinner, toast } from './ui';

interface Target {
  el: HTMLElement;
  word: string;
  text: string;
  offset: number;
}

/**
 * Makes the `.tw` word spans inside it tappable. Taps on words never reach the
 * card's own handlers (reveal, swipe); everything else passes through.
 * `resetKey` closes the popover when it changes (e.g. the card flips).
 */
export function TapWords({ children, className, resetKey }: { children: ReactNode; className?: string; resetKey?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => setTarget(null), [resetKey]);

  const open = (el: HTMLElement) => {
    const container = (el.closest('.card-html') as HTMLElement | null) ?? ref.current!;
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(el, 0);
    setTarget({ el, word: el.textContent ?? '', text: container.textContent ?? '', offset: range.toString().length });
  };

  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest?.('.tw') as HTMLElement | null;
    if (!el || !ref.current?.contains(el)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return; // selecting text, not tapping
    e.stopPropagation();
    e.preventDefault();
    open(el);
  };

  // Keep the tapped word highlighted while its popover is open.
  useEffect(() => {
    if (!target) return;
    target.el.setAttribute('data-open', '');
    return () => target.el.removeAttribute('data-open');
  }, [target]);

  // While the answer field has focus, tapping a word shouldn't take it away.
  const onMouseDown = (e: React.MouseEvent) => {
    const a = document.activeElement;
    if ((a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && (e.target as HTMLElement).closest?.('.tw')) e.preventDefault();
  };

  return (
    <div ref={ref} className={className} onClick={onClick} onMouseDown={onMouseDown}>
      {children}
      {target && <WordPopover key={`${target.word}-${target.offset}`} target={target} onClose={() => setTarget(null)} onRetarget={open} />}
    </div>
  );
}

type State =
  | { kind: 'loading' }
  | { kind: 'ai' }
  | { kind: 'found'; matches: WordMatch[]; viaAi: boolean }
  | { kind: 'none'; reason: 'offline' | 'unknown' | 'error' };

function useLookup(target: Target): State {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    (async () => {
      const index = await getWordIndex();
      const local = lookupInText(index, target.text, target.offset);
      if (!alive) return;
      if (local?.matches.length) return setState({ kind: 'found', matches: local.matches, viaAi: false });
      const asMatch = (e: DictEntry): WordMatch => ({ entry: e, surface: target.word, how: 'ai', score: 0 });
      const cached = await cachedAiLookup(target.word);
      if (!alive) return;
      if (cached) {
        const e = entryFromAi(target.word, cached);
        return setState(e ? { kind: 'found', matches: [asMatch(e)], viaAi: true } : { kind: 'none', reason: 'unknown' });
      }
      if (!hub()) return setState({ kind: 'none', reason: 'offline' });
      setState({ kind: 'ai' });
      try {
        const a = await aiLookup(target.word, sentenceAt(target.text, target.offset));
        if (!alive) return;
        const e = entryFromAi(target.word, a);
        setState(e ? { kind: 'found', matches: [asMatch(e)], viaAi: true } : { kind: 'none', reason: 'unknown' });
      } catch (err) {
        if (alive) setState({ kind: 'none', reason: err instanceof LookupUnavailable ? 'offline' : 'error' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [target]);
  return state;
}

const WIDTH = 320;
const GAP = 8;
const MARGIN = 12;

function WordPopover({ target, onClose, onRetarget }: { target: Target; onClose: () => void; onRetarget: (el: HTMLElement) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);
  const state = useLookup(target);

  // Position next to the word: below it, or above when there's no room; re-measure on scroll/resize.
  useLayoutEffect(() => {
    const place = () => {
      if (!target.el.isConnected) return onClose();
      const r = target.el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(WIDTH, vw - MARGIN * 2);
      const h = panel.current?.offsetHeight ?? 180;
      const left = Math.max(MARGIN, Math.min(r.left + r.width / 2 - width / 2, vw - width - MARGIN));
      const below = r.bottom + GAP + h <= vh - MARGIN || r.top - GAP - h < MARGIN;
      setPos({ left, top: below ? r.bottom + GAP : r.top - GAP - h, width, above: !below });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [target, state, onClose]);

  // Escape closes the popover (and only the popover: the study screen would exit on Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Taps outside close it; a tap on another word opens that word right away.
  const onBackdrop = (e: React.MouseEvent) => {
    e.stopPropagation();
    const below = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.classList.contains('tw')) as HTMLElement | undefined;
    if (below && below !== target.el) onRetarget(below);
    else onClose();
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div onClick={stop} onPointerDown={stop} onPointerUp={stop} onPointerMove={stop}>
      <div className="fixed inset-0 z-40" onClick={onBackdrop} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-label={tr('Wort nachschlagen')}
        className="anim-in fixed z-50 overflow-hidden rounded-md border border-line bg-paper-raised shadow-xl"
        style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: -9999, top: 0, width: WIDTH, visibility: 'hidden' }}
      >
        <PopoverBody target={target} state={state} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

const SOURCE_LABEL: Record<DictEntry['source'], string> = {
  note: 'Aus deinen Karten',
  builtin: 'Aus dem Grundwortschatz',
  ai: 'Von Otto (KI)',
};

function PopoverBody({ target, state, onClose }: { target: Target; state: State; onClose: () => void }) {
  if (state.kind === 'loading' || state.kind === 'ai') {
    return (
      <div className="flex items-center gap-3 px-4 py-4">
        <Spinner className="size-5" />
        <div className="min-w-0">
          <div className="t-label truncate" lang="de">
            {target.word}
          </div>
          <div className="t-caption text-ink-muted">{state.kind === 'ai' ? tr('Otto schlägt nach …') : tr('Nachschlagen …')}</div>
        </div>
      </div>
    );
  }
  if (state.kind === 'none') {
    const sentence = sentenceAt(target.text, target.offset);
    return (
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="t-heading break-words" lang="de">
              {target.word}
            </div>
            <div className="t-body mt-1 text-ink-muted">{tr('Keine Bedeutung gefunden')}</div>
            <div className="t-caption mt-1 text-ink-muted">
              {state.reason === 'offline'
                ? tr('Verbinde deinen Mac, damit Otto unbekannte Wörter nachschlagen kann.')
                : state.reason === 'error'
                  ? tr('Otto konnte das Wort gerade nicht nachschlagen.')
                  : tr('Vielleicht ein Name oder kein deutsches Wort.')}
            </div>
          </div>
          <SpeakButton text={target.word} className="size-10" />
        </div>
        <CollectButton german={target.word} english="" example={exampleFrom(sentence)} onDone={onClose} />
      </div>
    );
  }

  const [main, ...rest] = state.matches;
  const e = main!.entry;
  const alts = rest.filter((m) => m.score >= main!.score - 15 && m.entry.english !== e.english).slice(0, 2);
  return (
    <div className="px-4 py-4">
      <EntryView match={main!} />
      {alts.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="t-overline text-ink-muted">{tr('Auch möglich')}</div>
          {alts.map((m) => (
            <div key={m.entry.id} className="t-caption mt-1">
              <GenderWord word={m.entry.lemma} gender={m.entry.gender} className="font-bold text-ink" />
              {m.entry.pos && POS_LABEL[m.entry.pos] ? <span className="text-ink-muted"> · {POS_LABEL[m.entry.pos]}</span> : null}
              <span className="text-ink-muted"> · {m.entry.english}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="t-caption flex min-w-0 items-center gap-1 truncate text-ink-muted">
          {e.source === 'ai' && <Sparkles className="size-3.5 shrink-0" />}
          {tr(SOURCE_LABEL[e.source])}
        </span>
        {e.source === 'note' ? (
          <span className="t-caption flex shrink-0 items-center gap-1 font-bold text-wiese">
            <CheckCircle2 className="size-4" />
            {tr('In deinen Karten')}
          </span>
        ) : !e.functionWord ? (
          <CollectButton
            german={e.lemma}
            english={e.english}
            pos={e.pos}
            gender={e.gender}
            plural={e.plural}
            forms={e.forms}
            example={exampleFrom(sentenceAt(target.text, target.offset))}
            onDone={onClose}
            compact
          />
        ) : null}
      </div>
    </div>
  );
}

function EntryView({ match }: { match: WordMatch }) {
  const e = match.entry;
  const g = parseGender(e.gender);
  const noun = e.pos === 'noun' || !!g;
  const pos = POS_LABEL[e.pos] ?? '';
  const pl = noun ? pluralDisplay(e.plural) : null;
  const verbForms = e.pos === 'verb' && e.forms ? formatVerbForms(parseVerbForms(e.forms)) || e.forms : null;
  const otherForms = !noun && e.pos !== 'verb' && e.forms ? e.forms : null;
  const surface = match.surface.toLowerCase();
  const showFrom = surface !== e.lemma.toLowerCase() && !e.functionWord;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {pos && <div className="t-overline text-ink-muted">{pos}</div>}
          <div className="t-heading mt-1 break-words">
            <GenderWord word={e.lemma} gender={e.gender} />
          </div>
          {showFrom && (
            <div className="t-caption mt-0.5 text-ink-muted" lang="de">
              {tr('Grundform von „{0}“', match.surface)}
            </div>
          )}
        </div>
        <SpeakButton text={withArticle(e.lemma, e.gender)} tint={g} className="size-10" />
      </div>
      {pl && (
        <div className="t-caption mt-1.5 text-ink-muted" lang="de">
          {tr('Plural:')} <span className="font-bold text-ink">{pl}</span>
        </div>
      )}
      {verbForms && (
        <div className="t-caption mt-1.5 text-ink-muted" lang="de">
          {tr('Formen:')} <span className="font-bold text-ink">{verbForms}</span>
        </div>
      )}
      {otherForms && (
        <div className="t-caption mt-1.5 text-ink-muted" lang="de">
          {otherForms}
        </div>
      )}
      <div className="t-body-lg mt-2">{e.english}</div>
    </>
  );
}

/** The card's sentence makes a fine example, unless it's a cloze gap or too long. */
function exampleFrom(sentence: string): string {
  return sentence && !/\[[^\]]*\]/.test(sentence) && sentence.length <= 160 && sentence.split(' ').length >= 3 ? sentence : '';
}

function CollectButton({
  compact,
  onDone,
  ...input
}: {
  german: string;
  english: string;
  pos?: string;
  gender?: string;
  plural?: string;
  forms?: string;
  example?: string;
  compact?: boolean;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'busy' | 'added' | 'exists'>('checking');
  useEffect(() => {
    let alive = true;
    findWordNote(input.german)
      .then((n) => alive && setStatus(n ? 'exists' : 'ready'))
      .catch(() => alive && setStatus('ready'));
    return () => {
      alive = false;
    };
  }, [input.german]);

  if (status === 'exists' || status === 'added') {
    return (
      <span className={cx('t-caption flex shrink-0 items-center gap-1 font-bold text-wiese', !compact && 'mt-3')}>
        <CheckCircle2 className="size-4" />
        {status === 'added' ? tr('Hinzugefügt') : tr('Schon in deinen Karten')}
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      className={cx('shrink-0', !compact && 'mt-3')}
      loading={status === 'busy'}
      disabled={status === 'checking'}
      icon={<Plus className="size-4" />}
      onClick={async () => {
        setStatus('busy');
        try {
          const note = await collectWord(input);
          setStatus(note ? 'added' : 'exists');
          if (note) toast.success(tr('„{0}“ zu {1} hinzugefügt', withArticle(input.german, input.gender), GESAMMELT_DECK));
          setTimeout(onDone, 700);
        } catch (e) {
          setStatus('ready');
          toast.error(tr('Speichern fehlgeschlagen: {0}', (e as Error).message));
        }
      }}
    >
      {tr('Zu Gesammelt')}
    </Button>
  );
}
