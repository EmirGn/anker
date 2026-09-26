import {
  buildQueue,
  dayStartMs,
  deckPath,
  expectedTypedAnswer,
  formatDuration,
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
import { Ban, EyeOff, MoreHorizontal, Pencil, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AISheet } from '../components/AISheet';
import { autoSpeech, cardAccent, CardView } from '../components/CardView';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { Button, cx, IconButton, Kbd, Modal, Ring, Spinner, toast, useConfirm } from '../components/ui';
import { db } from '../lib/db';
import { diffAnswer, judgeAnswer, type DiffSeg, type Verdict } from '../lib/diff';
import { useHotkeys, useHub, useIsWide } from '../lib/hooks';
import { haptic, isNative } from '../lib/platform';
import { buryCards, deleteNotes, getPrefs, recordAnswer, setCardsSuspended, undoAnswer } from '../lib/repo';
import { navigate, useRoute } from '../lib/router';
import { speak, stopSpeaking } from '../lib/tts';
import { NoteEditor } from './Editor';

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

const RATINGS: { r: Rating; label: string; color: string; key: string }[] = [
  { r: 1, label: 'Again', color: 'var(--again)', key: '1' },
  { r: 2, label: 'Hard', color: 'var(--hard)', key: '2' },
  { r: 3, label: 'Good', color: 'var(--good)', key: '3' },
  { r: 4, label: 'Easy', color: 'var(--easy)', key: '4' },
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
            s.kind === 'ok' && 'text-good',
            s.kind === 'wrong' && 'rounded bg-again/15 text-again line-through decoration-2',
            s.kind === 'missing' && 'rounded bg-hard/20 text-ink underline decoration-hard decoration-2 underline-offset-4',
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
  const [title, setTitle] = useState('Study');
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
      setTitle(mode === 'cram' ? 'Practice' : root ? root.name : 'All decks');
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
      toast.error(`Couldn't save: ${(e as Error).message}`);
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
      toast('Undone');
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
    toast('Buried until tomorrow');
    removeCurrent(true);
  };

  const suspend = async () => {
    if (!current) return;
    await setCardsSuspended([current.card.id], true);
    toast('Card suspended — find it in Browse → Suspended');
    removeCurrent(false);
  };

  const del = async () => {
    if (!current) return;
    const ok = await confirm('Delete this note?', { body: 'The note and all its cards are removed on every device.', confirm: 'Delete', danger: true });
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
  const accent = current ? cardAccent(current.note, current.card.ord, phase === 'answer' ? 'answer' : 'question') : null;

  const topBar = (
    <div className="pt-safe sticky top-0 z-10 bg-bg/85 backdrop-blur-xl">
      <div className="drag mx-auto flex h-14 max-w-3xl items-center gap-2 px-3 md:h-16 md:px-6">
        <IconButton label="End session (Esc)" onClick={exit} className="no-drag">
          <X className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 truncate text-center text-[14px] font-semibold text-muted">{title}</div>
        {mode === 'review' ? (
          <div className="no-drag flex gap-2.5 text-[14px] font-semibold tabular-nums">
            {(
              [
                ['new', counts.new, 'var(--easy)'],
                ['learning', counts.learn, 'var(--again)'],
                ['review', counts.review, 'var(--good)'],
              ] as const
            ).map(([k, v, color]) => (
              <span
                key={k}
                style={{ color: v ? color : undefined }}
                className={cx(!v && 'text-faint', current?.queue === k && 'underline decoration-2 underline-offset-4')}
                title={k}
              >
                {v}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[14px] font-semibold text-muted tabular-nums">{remaining}</span>
        )}
        <IconButton label="Undo (U)" onClick={() => void undo()} disabled={!undoStack.current.length} className="no-drag">
          <Undo2 className="size-[18px]" />
        </IconButton>
        <div className="no-drag relative">
          <IconButton label="More" onClick={() => setMenuOpen((v) => !v)} disabled={!current}>
            <MoreHorizontal className="size-5" />
          </IconButton>
          {menuOpen && current && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="anim-in absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-xl">
                {[
                  { icon: Pencil, label: 'Edit note', key: 'E', run: () => setEditing(true) },
                  ...(hub ? [{ icon: Sparkles, label: 'AI help', key: 'A', run: () => setAiOpen(true) }] : []),
                  { icon: EyeOff, label: 'Bury until tomorrow', key: 'B', run: () => void bury() },
                  { icon: Ban, label: 'Suspend card', key: '!', run: () => void suspend() },
                  { icon: Trash2, label: 'Delete note', key: '', run: () => void del(), danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setMenuOpen(false);
                      item.run();
                    }}
                    className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] hover:bg-surface-2', 'danger' in item && item.danger && 'text-again')}
                  >
                    <item.icon className="size-4" />
                    <span className="flex-1">{item.label}</span>
                    {item.key && wide && <Kbd>{item.key}</Kbd>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="h-[3px] bg-surface-2">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
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
    return (
      <div className="flex min-h-full flex-col">
        {topBar}
        <div className="anim-in mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="text-6xl">{phase === 'done' ? '🎉' : '🌿'}</div>
          <h1 className="mt-5 font-display text-[32px] font-semibold">{phase === 'done' ? 'Geschafft!' : 'Nothing due here'}</h1>
          <p className="mt-2 text-muted">
            {phase === 'done'
              ? `You reviewed ${stats.done} card${stats.done === 1 ? '' : 's'}${stats.learned ? ` and learned ${stats.learned} new` : ''}.`
              : 'This deck has no cards due right now. Practice anyway or add new words.'}
          </p>
          {phase === 'done' && stats.done > 0 && (
            <div className="mt-8 grid w-full grid-cols-3 gap-3">
              {[
                ['Cards', stats.done],
                ['Correct', `${acc}%`],
                ['Time', formatDuration(stats.timeMs)],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-2xl border border-line bg-surface px-3 py-3">
                  <div className="text-[12px] text-faint">{k}</div>
                  <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-8 flex w-full flex-col gap-2">
            <Button variant="primary" size="lg" onClick={() => navigate('/')}>
              Back to Today
            </Button>
            {mode === 'review' && (
              <Button size="lg" onClick={() => navigate(`/study?mode=cram&q=${encodeURIComponent(deckId ? `deck:"${deckPath(decksRef.current.get(deckId)!, decksRef.current)}"` : 'rated:1')}`)}>
                {deckId ? 'Practice this deck' : "Practice today's cards again"}
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => navigate('/practice')}>
              Play a practice game
            </Button>
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
        <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
          <Ring value={1 - left / (20 * 60_000)} size={120} stroke={9}>
            <span className="text-2xl font-semibold tabular-nums">
              {mm}:{String(ss).padStart(2, '0')}
            </span>
          </Ring>
          <h2 className="mt-6 font-display text-2xl font-semibold">Kurze Pause</h2>
          <p className="mt-2 text-muted">Your next learning card is due soon. Spacing it out helps it stick.</p>
          <div className="mt-6 flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                const n = session.current?.next(waitUntil);
                if (n?.kind === 'card') void show(n.card, n.queue);
              }}
            >
              Continue now
            </Button>
            <Button onClick={exit}>Finish</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const expected = typing ? expectedTypedAnswer(current.note, current.card.ord) : '';
  const diff = typing && phase === 'answer' ? diffAnswer(typed.trim(), expected) : null;
  const swipeColor = drag > 40 ? 'var(--good)' : drag < -40 ? 'var(--again)' : null;

  return (
    <div className="flex min-h-full flex-col">
      {topBar}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-3 pt-4 pb-40 md:px-6 md:pt-8">
        <div
          className="relative flex min-h-[46vh] flex-1 touch-pan-y flex-col items-center justify-center overflow-hidden rounded-[28px] border border-line bg-surface px-5 py-10 shadow-card select-text md:min-h-[52vh] md:px-10"
          style={{
            transform: drag ? `translateX(${drag}px) rotate(${drag / 40}deg)` : undefined,
            transition: drag ? 'none' : 'transform .25s cubic-bezier(.2,.8,.2,1)',
            boxShadow: swipeColor ? `0 0 0 3px ${swipeColor}` : undefined,
          }}
          onClick={() => phase === 'question' && !typing && !wide && reveal()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          key={`${current.card.id}-${current.shownAt}`}
        >
          {accent && <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: accent }} />}
          {current.card.lapses >= cfgFor(current.card.deckId).leechThreshold && (
            <span className="absolute top-4 left-4 rounded-full bg-again/12 px-2 py-0.5 text-[11px] font-semibold text-again">🩹 leech</span>
          )}
          {current.queue === 'new' && <span className="absolute top-4 right-4 rounded-full bg-easy/12 px-2 py-0.5 text-[11px] font-semibold text-easy">new</span>}
          <div className="anim-in w-full">
            <CardView note={current.note} ord={current.card.ord} side={phase === 'answer' ? 'answer' : 'question'} hideProductionHint={typing} />
          </div>
          {typing && phase === 'question' && (
            <form
              className="mt-8 w-full max-w-md"
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
                placeholder="Type the answer…"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                lang="de"
                className="h-13 w-full rounded-2xl border border-line bg-surface-2 px-4 text-center font-display text-[20px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              {!isNative && <UmlautBar className="mt-2 justify-center" onInsert={(ch) => insertAtCaret(inputRef.current, ch, setTyped)} />}
            </form>
          )}
          {diff && (
            <div className="mt-8 w-full max-w-md space-y-1.5 rounded-2xl bg-surface-2 px-4 py-3 text-left">
              <div className="flex items-baseline gap-2">
                <span className="w-16 shrink-0 text-[11px] font-semibold tracking-wide text-faint uppercase">You</span>
                {typed.trim() ? <Diff segs={diff.typed} kind="typed" /> : <span className="text-sm text-faint italic">(nothing)</span>}
              </div>
              {verdict !== 'exact' && (
                <div className="flex items-baseline gap-2">
                  <span className="w-16 shrink-0 text-[11px] font-semibold tracking-wide text-faint uppercase">Answer</span>
                  <Diff segs={diff.expected} kind="expected" />
                </div>
              )}
              <div className={cx('pt-1 text-[13px] font-semibold', verdict === 'exact' ? 'text-good' : verdict === 'close' ? 'text-hard' : 'text-again')}>
                {verdict === 'exact' ? 'Perfekt! ✓' : verdict === 'close' ? 'Almost — check capitals, umlauts or punctuation.' : 'Not quite.'}
              </div>
            </div>
          )}
        </div>
        {hub && phase === 'answer' && (
          <div className="mt-3 flex justify-center">
            <button onClick={() => setAiOpen(true)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink">
              <Sparkles className="size-4 text-accent" /> Explain this card {wide && <Kbd>A</Kbd>}
            </button>
          </div>
        )}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-bg via-bg/95 to-transparent pt-6">
        <div className="mx-auto max-w-3xl px-3 pb-4 md:px-6 md:pb-6">
          {phase === 'question' ? (
            <Button variant="primary" size="lg" className="h-14 w-full text-[16px]" onClick={reveal}>
              {typing ? 'Check' : 'Show answer'} {wide && <Kbd>Space</Kbd>}
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ r, label, color, key }) => (
                <button
                  key={r}
                  onClick={() => void answer(r)}
                  className={cx(
                    'flex h-16 flex-col items-center justify-center rounded-2xl border bg-surface transition-all active:scale-[0.97]',
                    suggested === r ? 'border-transparent ring-2' : 'border-line hover:bg-surface-2',
                  )}
                  style={suggested === r ? ({ ['--tw-ring-color' as string]: color } as React.CSSProperties) : undefined}
                >
                  <span className="text-[15px] font-semibold" style={{ color }}>
                    {label}
                  </span>
                  <span className="mt-0.5 text-[12px] text-faint tabular-nums">
                    {mode === 'cram' ? (r === 1 ? 'again soon' : '✓') : previews?.[r]?.label ?? ''}
                    {wide && <span className="ml-1.5 opacity-60">{key}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!wide && phase === 'answer' && <p className="mt-2 text-center text-[11.5px] text-faint">Swipe the card → Good · ← Again</p>}
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit note" wide>
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
