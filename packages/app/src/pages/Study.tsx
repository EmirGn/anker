import {
  buildQueue,
  dayStartMs,
  deckPath,
  expectedTypedAnswer,
  isProductionCard,
  matchesQuery,
  nextDayStartMs,
  parseQuery,
  previewCard,
  resolveDeckConfig,
  StudySession,
  subtreeIds,
  type Card,
  type Deck,
  type DeckConfig,
  type DeckCounts,
  type IntervalPreview,
  type Note,
  type Rating,
  type ReviewLog,
} from '@anker/core';
import { Ban, EyeOff, MoreHorizontal, Pencil, Sparkles, Trash2, Undo2, X } from '../components/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AISheet } from '../components/AISheet';
import { CheckIcon } from '@phosphor-icons/react';
import { autoSpeech, cardTint, CardView } from '../components/CardView';
import { OttoBadge } from '../components/Otto';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { Button, cx, IconButton, Kbd, Modal, Ring, Spinner, toast, useConfirm } from '../components/ui';
import { db } from '../lib/db';
import { anzahl, dauer, intervall } from '../lib/format';
import { diffAnswer, judgeAnswer, type DiffSeg, type Verdict } from '../lib/diff';
import { useHotkeys, useHub, useIsWide } from '../lib/hooks';
import { haptic, isNative } from '../lib/platform';
import { buryCards, deleteNotes, getPrefs, recordAnswer, setCardsSuspended, undoAnswer } from '../lib/repo';
import { navigate, useRoute } from '../lib/router';
import { speak, stopSpeaking } from '../lib/tts';
import { NoteEditor } from './Editor';
import { tr } from '../lib/i18n';

type Phase = 'loading' | 'question' | 'answer' | 'wait' | 'done' | 'empty';
type QueueKind = 'learning' | 'review' | 'new';

interface Current {
  card: Card;
  note: Note;
  queue: QueueKind;
  shownAt: number;
}

interface UndoEntry {
  prev: Card;
  log: ReviewLog | null;
  queue: QueueKind;
}

// "Nochmal" is koralle-ink (never red: red belongs to die); the suggested answer is an ink fill.
const RATINGS: { r: Rating; label: string; key: string }[] = [
  { r: 1, label: tr('Nochmal'), key: '1' },
  { r: 2, label: tr('Schwer'), key: '2' },
  { r: 3, label: tr('Gut'), key: '3' },
  { r: 4, label: tr('Leicht'), key: '4' },
];

function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function Diff({ segs, kind }: { segs: DiffSeg[]; kind: 'typed' | 'expected' }) {
  return (
    <span className="font-mono text-[17px] tracking-tight">
      {segs.map((s, i) => (
        <span
          key={i}
          className={cx(
            s.kind === 'ok' && 'text-wiese',
            s.kind === 'wrong' && 'rounded-xs bg-koralle-soft text-koralle-ink',
            s.kind === 'missing' && 'text-ink underline decoration-sonne decoration-[3px] underline-offset-4',
          )}
        >
          {s.text.replace(/ /g, kind === 'expected' && s.kind === 'missing' ? '␣' : ' ')}
        </span>
      ))}
    </span>
  );
}

export function Study({ deckId }: { deckId: string | null }) {
  const { query } = useRoute();
  const mode: 'review' | 'cram' = query.get('mode') === 'cram' ? 'cram' : 'review';
  const q = query.get('q') ?? '';
  const wide = useIsWide();
  const hub = useHub();
  const [confirm, confirmNode] = useConfirm();

  const [phase, setPhase] = useState<Phase>('loading');
  const [current, setCurrent] = useState<Current | null>(null);
  const [counts, setCounts] = useState<DeckCounts>({ new: 0, learn: 0, review: 0 });
  const [waitUntil, setWaitUntil] = useState(0);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [previews, setPreviews] = useState<Record<Rating, IntervalPreview> | null>(null);
  const [title, setTitle] = useState('Lernen');
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [stats, setStats] = useState({ done: 0, again: 0, timeMs: 0, learned: 0, started: Date.now() });
  const [drag, setDrag] = useState(0);
  const [now, setNow] = useState(Date.now());

  const session = useRef<StudySession | null>(null);
  const cram = useRef<Card[]>([]);
  const notes = useRef(new Map<string, Note>());
  const cfgCache = useRef(new Map<string, DeckConfig>());
  const decksRef = useRef<Map<string, Deck>>(new Map());
  const undoStack = useRef<UndoEntry[]>([]);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef(0);

  const cfgFor = useCallback((deckIdOfCard: string): DeckConfig => {
    let c = cfgCache.current.get(deckIdOfCard);
    if (!c) {
      c = resolveDeckConfig(decksRef.current.get(deckIdOfCard), decksRef.current);
      cfgCache.current.set(deckIdOfCard, c);
    }
    return c;
  }, []);

  const typingMode = useCallback(
    (card: Card, note: Note) => note.type === 'typing' || (cfgFor(card.deckId).typeAnswer && isProductionCard(note, card.ord)),
    [cfgFor],
  );

  const refreshCounts = () => {
    if (mode === 'cram') setCounts({ new: 0, learn: 0, review: cram.current.length });
    else if (session.current) setCounts(session.current.counts());
  };

  const show = useCallback(
    async (card: Card, queue: QueueKind) => {
      let note = notes.current.get(card.noteId);
      if (!note) {
        note = await db.notes.get(card.noteId);
        if (note) notes.current.set(note.id, note);
      }
      if (!note) {
        // Note vanished (deleted elsewhere) — skip it.
        session.current?.removeNote(card.noteId);
        advanceRef.current();
        return;
      }
      setCurrent({ card, note, queue, shownAt: Date.now() });
      setTyped('');
      setVerdict(null);
      setPreviews(null);
      setDrag(0);
      setPhase('question');
      refreshCounts();
      const cfg = cfgFor(card.deckId);
      if (cfg.autoSpeak) {
        const t = autoSpeech(note, card.ord, 'question');
        if (t) void speak(t);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfgFor, mode],
  );

  const advance = useCallback(() => {
    const t = Date.now();
    if (mode === 'cram') {
      const c = cram.current.shift();
      if (c) void show(c, 'review');
      else setPhase('done');
      return;
    }
    const s = session.current;
    if (!s) return;
    const n = s.next(t);
    if (n.kind === 'card') void show(n.card, n.queue);
    else if (n.kind === 'wait') {
      setCurrent(null);
      setWaitUntil(n.until);
      setPhase('wait');
      refreshCounts();
    } else {
      setCurrent(null);
      setPhase('done');
      refreshCounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, show]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // ---- load the session once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [decks, prefs] = await Promise.all([db.decks.toArray(), getPrefs()]);
      decksRef.current = new Map(decks.map((d) => [d.id, d]));
      const t = Date.now();
      const root = deckId ? decksRef.current.get(deckId) : undefined;
      setTitle(mode === 'cram' ? tr('Üben') : root ? root.name : tr('Alle Decks'));
      if (mode === 'cram') {
        const [allNotes, allCards] = await Promise.all([db.notes.toArray(), db.cards.toArray()]);
        const terms = parseQuery(q);
        let only: Set<string> | null = null;
        if (query.get('sel') === '1') {
          try {
            only = new Set(JSON.parse(sessionStorage.getItem('anker-cram-ids') ?? '[]'));
          } catch {
            only = new Set();
          }
        }
        const byNote = new Map<string, Card[]>();
        for (const c of allCards) byNote.set(c.noteId, [...(byNote.get(c.noteId) ?? []), c]);
        const ctx = { now: t, dayEnd: nextDayStartMs(t, prefs.rolloverHour) };
        const picked: Card[] = [];
        for (const n of allNotes) {
          const cards = byNote.get(n.id) ?? [];
          const target = { note: n, cards, deckPath: deckPath(decksRef.current.get(n.deckId) ?? { id: '', name: '', parentId: null, createdAt: 0, updatedAt: 0 }, decksRef.current) };
          if (only ? !only.has(n.id) : !matchesQuery(terms, target, ctx)) continue;
          notes.current.set(n.id, n);
          const c = cards.filter((x) => !x.suspended);
          if (c.length) picked.push(c[Math.floor(Math.random() * c.length)]!);
        }
        cram.current = shuffle(picked).slice(0, 150);
        totalRef.current = cram.current.length;
      } else {
        const scope = deckId ? [...subtreeIds(deckId, decks)] : null;
        const cards = scope ? await db.cards.where('deckId').anyOf(scope).toArray() : await db.cards.toArray();
        const todayLogs = await db.revlog.where('review').aboveOrEqual(dayStartMs(t, prefs.rolloverHour)).toArray();
        const snap = buildQueue({ decks, rootDeckId: deckId, cards, todayLogs, now: t, rolloverHour: prefs.rolloverHour });
        const ids = [...new Set([...snap.learning, ...snap.review, ...snap.fresh].map((c) => c.noteId))];
        const ns = await db.notes.bulkGet(ids);
        ns.forEach((n) => n && notes.current.set(n.id, n));
        session.current = new StudySession(snap, { now: t, rolloverHour: prefs.rolloverHour });
        totalRef.current = session.current.totalRemaining();
      }
      if (cancelled) return;
      if (totalRef.current === 0) {
        setPhase('empty');
        return;
      }
      advance();
    })();
    return () => {
      cancelled = true;
      void stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, mode, q]);

  // ---- waiting for learning cards
  useEffect(() => {
    if (phase !== 'wait') return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= waitUntil) advanceRef.current();
    }, 1000);
    return () => clearInterval(t);
  }, [phase, waitUntil]);

  const reveal = () => {
    if (!current || phase !== 'question') return;
    const cfg = cfgFor(current.card.deckId);
    if (typingMode(current.card, current.note)) {
      setVerdict(judgeAnswer(typed, expectedTypedAnswer(current.note, current.card.ord)));
    }
    if (mode === 'review') setPreviews(previewCard(current.card, cfg, Date.now()));
    setPhase('answer');
    void haptic('tap');
    if (cfg.autoSpeak) {
      const t = autoSpeech(current.note, current.card.ord, 'answer');
      if (t) void speak(t);
    }
  };

  const answer = async (rating: Rating) => {
    if (!current || phase !== 'answer' || busy.current) return;
    busy.current = true;
    const duration = Date.now() - current.shownAt;
    try {
      void haptic(rating === 1 ? 'warning' : 'tap');
      setStats((s) => ({
        ...s,
        done: s.done + 1,
        again: s.again + (rating === 1 ? 1 : 0),
        timeMs: s.timeMs + Math.min(duration, 5 * 60_000),
        learned: s.learned + (current.queue === 'new' ? 1 : 0),
      }));
      if (mode === 'cram') {
        if (rating === 1) cram.current.splice(Math.min(cram.current.length, 3 + Math.floor(Math.random() * 3)), 0, current.card);
        undoStack.current.push({ prev: current.card, log: null, queue: 'review' });
      } else {
        const { next, log, prev } = await recordAnswer(current.card, rating, duration);
        session.current?.answered(next, current.queue);
        undoStack.current.push({ prev, log, queue: current.queue });
        if (undoStack.current.length > 50) undoStack.current.shift();
      }
      advance();
    } catch (e) {
      toast.error(tr('Speichern fehlgeschlagen: {0}', (e as Error).message));
    } finally {
      busy.current = false;
    }
  };

  const undo = async () => {
    const e = undoStack.current.pop();
    if (!e || busy.current) return;
    busy.current = true;
    try {
      if (mode === 'cram') {
        if (current) cram.current.unshift(current.card);
        cram.current = cram.current.filter((c) => c.id !== e.prev.id);
      } else if (e.log) {
        await undoAnswer(e.prev, e.log);
        session.current?.restore(e.prev, e.queue);
      }
      setStats((s) => ({ ...s, done: Math.max(0, s.done - 1) }));
      await show(e.prev, e.queue);
      toast(tr('Rückgängig gemacht'));
    } finally {
      busy.current = false;
    }
  };

  const removeCurrent = (whole: boolean) => {
    if (!current) return;
    if (whole) session.current?.removeNote(current.note.id);
    else session.current?.remove(current.card.id);
    cram.current = cram.current.filter((c) => (whole ? c.noteId !== current.note.id : c.id !== current.card.id));
    advance();
  };

  const bury = async () => {
    if (!current) return;
    const siblings = await db.cards.where('noteId').equals(current.note.id).primaryKeys();
    await buryCards(siblings);
    toast(tr('Bis morgen zurückgestellt'));
    removeCurrent(true);
  };

  const suspend = async () => {
    if (!current) return;
    await setCardsSuspended([current.card.id], true);
    toast(tr('Karte ausgesetzt – zu finden unter Karten suchen → Ausgesetzt'));
    removeCurrent(false);
  };

  const del = async () => {
    if (!current) return;
    const ok = await confirm(tr('Diese Notiz löschen?'), { body: tr('Die Notiz und alle ihre Karten werden auf jedem Gerät entfernt.'), confirm: tr('Löschen'), danger: true });
    if (!ok) return;
    await deleteNotes([current.note.id]);
    removeCurrent(true);
  };

  const exit = () => {
    void stopSpeaking();
    navigate(deckId ? `/decks/${deckId}` : '/');
  };

  const typing = !!current && typingMode(current.card, current.note);
  const suggested: Rating | null = verdict === 'exact' ? 3 : verdict === 'close' ? 2 : verdict === 'wrong' ? 1 : null;

  useHotkeys(
    {
      space: (e) => {
        e.preventDefault();
        if (phase === 'question') reveal();
        else if (phase === 'answer') void answer(suggested ?? 3);
      },
      enter: (e) => {
        e.preventDefault();
        if (phase === 'question') reveal();
        else if (phase === 'answer') void answer(suggested ?? 3);
      },
      '1': () => void answer(1),
      '2': () => void answer(2),
      '3': () => void answer(3),
      '4': () => void answer(4),
      u: () => void undo(),
      'mod+z': (e) => {
        e.preventDefault();
        void undo();
      },
      e: () => current && setEditing(true),
      r: () => {
        if (!current) return;
        const t = autoSpeech(current.note, current.card.ord, 'question') ?? autoSpeech(current.note, current.card.ord, 'answer');
        if (t) void speak(t);
      },
      b: () => void bury(),
      '!': () => void suspend(),
      a: () => current && hub && setAiOpen(true),
      escape: () => (editing || aiOpen || menuOpen ? undefined : exit()),
    },
    [phase, current, suggested, editing, aiOpen, menuOpen, typed],
  );

  // ---- swipe to answer (phones)
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (wide || e.pointerType === 'mouse') return;
    pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointer.current || phase !== 'answer') return;
    const dx = e.clientX - pointer.current.x;
    const dy = e.clientY - pointer.current.y;
    if (Math.abs(dx) > Math.abs(dy)) setDrag(dx);
  };
  const onPointerUp = () => {
    const d = drag;
    pointer.current = null;
    if (phase === 'answer' && Math.abs(d) > 90) void answer(d > 0 ? 3 : 1);
    else setDrag(0);
  };

  const remaining = mode === 'cram' ? cram.current.length + (current ? 1 : 0) : counts.new + counts.learn + counts.review;
  const progress = stats.done / Math.max(1, stats.done + remaining);
  const tint = current ? cardTint(current.note, current.card.ord, phase === 'answer' ? 'answer' : 'question') : null;

  const topBar = (
    <div className="pt-safe sticky top-0 z-10 bg-paper/90 backdrop-blur-xl">
      <div className="drag mx-auto flex h-14 max-w-3xl items-center gap-1 px-3 md:h-16 md:px-6">
        <IconButton label={tr('Beenden (Esc)')} onClick={exit} className="no-drag">
          <X className="size-6" />
        </IconButton>
        <div className="t-label min-w-0 flex-1 truncate text-center text-ink-muted">{title}</div>
        {mode === 'review' ? (
          <div className="no-drag flex gap-2.5 px-1 text-[15px] font-bold tabular-nums">
            {(
              [
                ['new', counts.new, 'var(--hafen)', 'neu'],
                ['learning', counts.learn, 'var(--koralle-ink)', 'in Arbeit'],
                ['review', counts.review, 'var(--wiese)', 'fällig'],
              ] as const
            ).map(([k, v, color, label]) => (
              <span
                key={k}
                style={{ color: v ? color : undefined }}
                className={cx(!v && 'text-ink-muted', current?.queue === k && 'underline decoration-2 underline-offset-4')}
                title={tr(label)}
              >
                {v}
              </span>
            ))}
          </div>
        ) : (
          <span className="px-1 text-[15px] font-bold text-ink-muted tabular-nums">{remaining}</span>
        )}
        <IconButton label={tr('Rückgängig (U)')} onClick={() => void undo()} disabled={!undoStack.current.length} className="no-drag">
          <Undo2 className="size-5" />
        </IconButton>
        <div className="no-drag relative">
          <IconButton label={tr('Mehr')} onClick={() => setMenuOpen((v) => !v)} disabled={!current}>
            <MoreHorizontal className="size-6" />
          </IconButton>
          {menuOpen && current && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="anim-in absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-line bg-paper-raised py-1.5 shadow-xl">
                {[
                  { icon: Pencil, label: tr('Notiz bearbeiten'), key: 'E', run: () => setEditing(true) },
                  ...(hub ? [{ icon: Sparkles, label: tr('KI-Hilfe'), key: 'A', run: () => setAiOpen(true) }] : []),
                  { icon: EyeOff, label: tr('Bis morgen zurückstellen'), key: 'B', run: () => void bury() },
                  { icon: Ban, label: tr('Karte aussetzen'), key: '!', run: () => void suspend() },
                  { icon: Trash2, label: tr('Notiz löschen'), key: '', run: () => void del(), danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setMenuOpen(false);
                      item.run();
                    }}
                    className={cx('flex h-11 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-paper-sunk', 'danger' in item && item.danger && 'text-koralle-ink')}
                  >
                    <item.icon className="size-5" />
                    <span className="flex-1">{item.label}</span>
                    {item.key && wide && <Kbd>{item.key}</Kbd>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="h-[3px] bg-paper-sunk">
        <div className="h-full bg-hafen transition-[width] duration-300 ease-out" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (phase === 'empty' || phase === 'done') {
    const acc = stats.done ? Math.round(((stats.done - stats.again) / stats.done) * 100) : 0;
    const done = phase === 'done';
    return (
      <div className="flex min-h-full flex-col">
        {topBar}
        <div className="anim-in mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-10 text-center">
          <OttoBadge size={132} mood={done ? 'proud' : 'sleepy'} />
          <h1 className="t-title mt-6">{done ? tr('Otto ist stolz!') : tr('Hier ist nichts fällig')}</h1>
          <p className="mt-2 text-[15px] text-ink-muted">
            {done
              ? tr('Du hast {0} wiederholt{1}.', anzahl(stats.done, '{0} Karte', '{0} Karten'), stats.learned ? tr(' und {0} neue gelernt', stats.learned) : '')
              : tr('In diesem Deck ist gerade nichts fällig. Üb trotzdem oder füge neue Wörter hinzu.')}
          </p>
          {done && stats.done > 0 && (
            <div className="mt-8 grid w-full grid-cols-3 overflow-hidden rounded-md border border-line bg-paper-raised py-3">
              {[
                ['Karten', String(stats.done)],
                ['Richtig', `${acc} %`],
                ['Zeit', dauer(stats.timeMs)],
              ].map(([k, v], i) => (
                <div key={k} className={cx('px-1', i > 0 && 'border-l border-line')}>
                  <div className="t-stat">{v}</div>
                  <div className="t-caption text-ink-muted">{tr(k)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-8 flex w-full flex-col gap-2">
            <Button variant="primary" size="lg" onClick={() => navigate('/')}>{tr('Zurück zu Heute')}</Button>
            {mode === 'review' && (
              <Button size="lg" onClick={() => navigate(`/study?mode=cram&q=${encodeURIComponent(deckId ? `deck:"${deckPath(decksRef.current.get(deckId)!, decksRef.current)}"` : 'rated:1')}`)}>
                {deckId ? tr('Dieses Deck üben') : tr('Heutige Karten nochmal üben')}
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => navigate('/practice')}>{tr('Ein Übungsspiel spielen')}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'wait') {
    const left = Math.max(0, waitUntil - now);
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    return (
      <div className="flex min-h-full flex-col">
        {topBar}
        <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-5 text-center">
          <Ring value={1 - left / (20 * 60_000)} size={120} stroke={9}>
            <span className="t-stat">
              {mm}:{String(ss).padStart(2, '0')}
            </span>
          </Ring>
          <h2 className="t-title mt-6">{tr('Kurze Pause')}</h2>
          <p className="mt-2 text-[15px] text-ink-muted">{tr('Deine nächste Lernkarte ist gleich wieder dran. Abstand hilft beim Merken.')}</p>
          <div className="mt-6 flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                const n = session.current?.next(waitUntil);
                if (n?.kind === 'card') void show(n.card, n.queue);
              }}
            >{tr('Jetzt weiter')}</Button>
            <Button onClick={exit}>{tr('Beenden')}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const expected = typing ? expectedTypedAnswer(current.note, current.card.ord) : '';
  const diff = typing && phase === 'answer' ? diffAnswer(typed.trim(), expected) : null;
  const swipeColor = drag > 40 ? 'var(--wiese)' : drag < -40 ? 'var(--koralle-ink)' : null;
  const defaultRating: Rating = suggested ?? 3;
  const leech = current.card.lapses >= cfgFor(current.card.deckId).leechThreshold;

  return (
    <div className="flex min-h-full flex-col">
      {topBar}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pt-4 pb-40 md:px-6 md:pt-8">
        <div
          className={cx(
            'relative flex min-h-[52vh] flex-1 touch-pan-y flex-col justify-center overflow-hidden rounded-lg px-5 py-8 select-text md:px-10',
            !tint && 'border border-line bg-paper-raised',
            verdict === 'exact' && phase === 'answer' && 'anim-lift',
          )}
          style={{
            background: tint ?? undefined,
            transform: drag ? `translateX(${drag}px) rotate(${drag / 40}deg)` : undefined,
            transition: drag ? 'none' : 'transform .2s ease-out, background-color .2s ease-out',
            boxShadow: swipeColor ? `0 0 0 3px ${swipeColor}` : undefined,
          }}
          onClick={() => phase === 'question' && !typing && !wide && reveal()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          key={`${current.card.id}-${current.shownAt}`}
        >
          {(leech || current.queue === 'new') && (
            <div className="mb-5 flex gap-2">
              {current.queue === 'new' && <span className="rounded-full bg-hafen-soft px-2.5 py-0.5 text-[13px] font-bold text-hafen">{tr('neu')}</span>}
              {leech && <span className="rounded-full bg-koralle-soft px-2.5 py-0.5 text-[13px] font-bold text-koralle-ink">{tr('Oft vergessen')}</span>}
            </div>
          )}
          <div className="anim-in w-full">
            <CardView note={current.note} ord={current.card.ord} side={phase === 'answer' ? 'answer' : 'question'} hideProductionHint={typing} />
          </div>
          {typing && phase === 'question' && (
            <form
              className="mt-8 w-full"
              onSubmit={(e) => {
                e.preventDefault();
                reveal();
              }}
            >
              <input
                ref={inputRef}
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={tr('Antwort eintippen …')}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                lang="de"
                className="h-14 w-full rounded-md border border-transparent bg-paper-sunk px-4 font-display text-[20px] font-semibold outline-none placeholder:font-sans placeholder:text-[17px] placeholder:font-normal placeholder:text-ink-muted field-focus"
              />
              {!isNative && <UmlautBar className="mt-2" onInsert={(ch) => insertAtCaret(inputRef.current, ch, setTyped)} />}
            </form>
          )}
          {diff && (
            <div className="mt-8 w-full space-y-1.5 rounded-md bg-paper-raised px-4 py-3 text-left">
              <div className="flex items-baseline gap-3">
                <span className="t-overline w-16 shrink-0 text-ink-muted">{tr('Du')}</span>
                {typed.trim() ? <Diff segs={diff.typed} kind="typed" /> : <span className="text-[15px] text-ink-muted">{tr('(nichts)')}</span>}
              </div>
              {verdict !== 'exact' && (
                <div className="flex items-baseline gap-3">
                  <span className="t-overline w-16 shrink-0 text-ink-muted">{tr('Lösung')}</span>
                  <Diff segs={diff.expected} kind="expected" />
                </div>
              )}
              <div className={cx('flex items-center gap-2 pt-1 text-[15px] font-bold', verdict === 'exact' ? 'text-wiese' : verdict === 'close' ? 'text-sonne-ink' : 'text-koralle-ink')}>
                {verdict === 'exact' ? (
                  <>
                    <span className="anim-pop inline-flex size-6 items-center justify-center rounded-full bg-wiese text-on-wiese">
                      <CheckIcon weight="bold" className="size-3.5" />
                    </span>{tr('Perfekt!')}</>
                ) : verdict === 'close' ? (
                  tr('Fast – prüf Großschreibung, Umlaute oder Satzzeichen.')
                ) : (
                  tr('Nicht ganz.')
                )}
              </div>
            </div>
          )}
        </div>
        {hub && phase === 'answer' && (
          <div className="mt-3 flex justify-center">
            <button onClick={() => setAiOpen(true)} className="flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold text-ink-muted hover:bg-paper-sunk hover:text-ink">
              <Sparkles className="size-5" />{' '}{tr('Karte erklären')}{' '}{wide && <Kbd>{tr('A')}</Kbd>}
            </button>
          </div>
        )}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-paper via-paper/95 to-transparent pt-6">
        <div className="mx-auto max-w-2xl px-5 pb-4 md:px-6 md:pb-6">
          {phase === 'question' ? (
            <Button variant="primary" size="lg" className="w-full" onClick={reveal}>
              {typing ? tr('Prüfen') : tr('Antwort zeigen')} {wide && <Kbd>{tr('Leertaste')}</Kbd>}
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ r, label, key }) => {
                const main = r === defaultRating;
                return (
                  <button
                    key={r}
                    onClick={() => void answer(r)}
                    className={cx(
                      'flex h-14 flex-col items-center justify-center rounded-md border transition-[transform,background] duration-[120ms] active:scale-[0.97]',
                      main ? 'border-ink bg-ink text-paper' : 'border-line bg-paper-raised hover:bg-paper-sunk',
                      !main && (r === 1 ? 'text-koralle-ink' : 'text-ink'),
                    )}
                  >
                    <span className="text-[15px] leading-[18px] font-semibold">{label}</span>
                    <span className={cx('text-[13px] leading-4 font-medium tabular-nums', main ? 'text-paper-sunk' : 'text-ink-muted')}>
                      {mode === 'cram' ? (r === 1 ? tr('gleich') : '–') : previews ? intervall(previews[r].due - Date.now()) : ''}
                      {wide && <span className="ml-1.5 opacity-60">{key}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!wide && phase === 'answer' && <p className="t-caption mt-2 text-center text-ink-muted">{tr('Karte wischen: → Gut · ← Nochmal')}</p>}
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={tr('Notiz bearbeiten')} wide>
        {editing && (
          <NoteEditor
            noteId={current.note.id}
            embedded
            onSaved={(n) => {
              notes.current.set(n.id, n);
              setCurrent((c) => (c ? { ...c, note: n } : c));
              setEditing(false);
            }}
          />
        )}
      </Modal>
      <AISheet note={current.note} open={aiOpen} onClose={() => setAiOpen(false)} />
      {confirmNode}
    </div>
  );
}
