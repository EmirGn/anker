import {
  CardState,
  deckPath,
  matchesQuery,
  nextDayStartMs,
  noteSubtitle,
  noteTitle,
  parseQuery,
  relativeTime,
  DAY,
  type Card,
  type Deck,
  type Note,
} from '@anker/core';
import { Brain, CheckSquare, FolderInput, Pause, Play, RotateCcw, Search, Square, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GenderWord } from '../components/CardView';
import { DeckSelect } from '../components/DeckSelect';
import { TagInput } from '../components/TagInput';
import { Button, Chip, cx, Empty, IconButton, Modal, PageHeader, Panel, Select, Spinner, toast, useConfirm } from '../components/ui';
import { db } from '../lib/db';
import { useIsWide, useLiveQuery, usePrefs } from '../lib/hooks';
import { deleteNotes, forgetNotes, moveNotes, suspendNotes, tagNotes } from '../lib/repo';
import { navigate, useRoute } from '../lib/router';
import { NoteEditor } from './Editor';

const FILTERS = [
  { label: 'Due', q: 'is:due' },
  { label: 'New', q: 'is:new' },
  { label: 'Nouns', q: 'pos:noun' },
  { label: 'Verbs', q: 'pos:verb' },
  { label: 'Leeches', q: 'is:leech' },
  { label: 'Suspended', q: 'is:suspended' },
  { label: 'Added this week', q: 'added:7' },
  { label: 'Reviewed today', q: 'rated:1' },
];

type SortKey = 'new' | 'alpha' | 'due' | 'lapses';

function status(cards: Card[], now: number): { label: string; color?: string } {
  if (!cards.length) return { label: '—' };
  if (cards.every((c) => c.suspended)) return { label: 'Suspended', color: 'var(--hard)' };
  const active = cards.filter((c) => !c.suspended);
  if (active.every((c) => c.state === CardState.New)) return { label: 'New', color: 'var(--easy)' };
  const due = Math.min(...active.filter((c) => c.state !== CardState.New).map((c) => c.due));
  if (due <= now) return { label: 'Due', color: 'var(--good)' };
  return { label: relativeTime(due, now).replace(/^in /, '') };
}

export function Browse() {
  const { query } = useRoute();
  const wide = useIsWide();
  const prefs = usePrefs();
  const [confirm, confirmNode] = useConfirm();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [sort, setSort] = useState<SortKey>('new');
  const [limit, setLimit] = useState(120);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [newTags, setNewTags] = useState<string[]>([]);

  useEffect(() => {
    const incoming = query.get('q');
    if (incoming !== null) {
      setQ(incoming);
      setDebounced(incoming);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(t);
  }, [q]);

  const data = useLiveQuery(async () => {
    const [notes, cards, decks, logs] = await Promise.all([
      db.notes.toArray(),
      db.cards.toArray(),
      db.decks.toArray(),
      db.revlog.where('review').above(Date.now() - 31 * DAY).toArray(),
    ]);
    return { notes, cards, decks, logs };
  }, []);

  const results = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const byDeck = new Map<string, Deck>(data.decks.map((d) => [d.id, d]));
    const byNote = new Map<string, Card[]>();
    for (const c of data.cards) byNote.set(c.noteId, [...(byNote.get(c.noteId) ?? []), c]);
    const rated = new Map<number, Set<string>>();
    const ctx = {
      now,
      dayEnd: nextDayStartMs(now, prefs.rolloverHour),
      ratedWithin: (days: number) => {
        let s = rated.get(days);
        if (!s) {
          s = new Set(data.logs.filter((l) => l.review >= now - days * DAY).map((l) => l.noteId));
          rated.set(days, s);
        }
        return s;
      },
    };
    const terms = parseQuery(debounced);
    const paths = new Map<string, string>();
    const pathOf = (id: string) => {
      let p = paths.get(id);
      if (p === undefined) {
        const d = byDeck.get(id);
        p = d ? deckPath(d, byDeck) : '';
        paths.set(id, p);
      }
      return p;
    };
    const out: { note: Note; cards: Card[]; path: string }[] = [];
    for (const note of data.notes) {
      const cards = byNote.get(note.id) ?? [];
      const path = pathOf(note.deckId);
      if (matchesQuery(terms, { note, cards, deckPath: path }, ctx)) out.push({ note, cards, path });
    }
    const title = new Map(out.map((r) => [r.note.id, noteTitle(r.note).replace(/^(der|die|das) /, '')]));
    const nextDue = (r: { cards: Card[] }) => Math.min(...r.cards.filter((c) => c.state !== CardState.New && !c.suspended).map((c) => c.due), Infinity);
    out.sort((a, b) => {
      switch (sort) {
        case 'alpha':
          return title.get(a.note.id)!.localeCompare(title.get(b.note.id)!, 'de', { sensitivity: 'base' });
        case 'due':
          return nextDue(a) - nextDue(b);
        case 'lapses':
          return Math.max(0, ...b.cards.map((c) => c.lapses)) - Math.max(0, ...a.cards.map((c) => c.lapses));
        default:
          return b.note.createdAt - a.note.createdAt;
      }
    });
    return out;
  }, [data, debounced, sort, prefs.rolloverHour]);

  const toggleFilter = (token: string) => {
    const has = q.split(/\s+/).includes(token);
    setQ(has ? q.split(/\s+/).filter((t) => t !== token).join(' ') : `${q.trim()} ${token}`.trim());
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const ids = [...selected];
  const now = Date.now();

  const open = (id: string) => {
    if (wide) setOpenId(id);
    else navigate(`/edit/${id}`);
  };

  return (
    <div className={cx('mx-auto px-4 pt-6 pb-24 md:px-8 md:pt-10', openId && wide ? 'max-w-[1400px]' : 'max-w-5xl')}>
      <PageHeader title="Browse" subtitle={results ? `${results.length} note${results.length === 1 ? '' : 's'}` : ' '} />
      <div className={cx(openId && wide && 'grid grid-cols-[1fr_520px] gap-6')}>
        <div className="min-w-0">
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder='Search…  e.g. haus deck:"Deutsch::A1" gender:die is:due'
                className="h-11 w-full rounded-xl border border-line bg-surface pr-9 pl-10 text-[15px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              {q && (
                <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-faint hover:text-ink" aria-label="Clear search">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-36 shrink-0">
              <option value="new">Newest</option>
              <option value="alpha">A–Z</option>
              <option value="due">Due date</option>
              <option value="lapses">Most lapses</option>
            </Select>
          </div>
          <div className="thin-scroll -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {FILTERS.map((f) => {
              const active = q.split(/\s+/).includes(f.q);
              return (
                <button
                  key={f.q}
                  onClick={() => toggleFilter(f.q)}
                  className={cx('shrink-0 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors', active ? 'border-transparent bg-ink text-bg' : 'border-line text-muted hover:bg-surface-2')}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {!results ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <Panel>
              <Empty icon={<Search className="size-7" />} title="Nothing found">
                Try fewer words, or search syntax like <code className="rounded bg-surface-2 px-1">tag:A2</code>, <code className="rounded bg-surface-2 px-1">is:leech</code> or <code className="rounded bg-surface-2 px-1">-is:suspended</code>.
              </Empty>
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line bg-surface-2/40 px-3 py-2">
                <IconButton
                  label={selected.size ? 'Clear selection' : 'Select all shown'}
                  className="size-8"
                  onClick={() => setSelected(selected.size ? new Set() : new Set(results.slice(0, limit).map((r) => r.note.id)))}
                >
                  {selected.size ? <CheckSquare className="size-[18px] text-accent-strong" /> : <Square className="size-[18px]" />}
                </IconButton>
                <span className="text-[12.5px] text-faint">{selected.size ? `${selected.size} selected` : 'Select to edit many at once'}</span>
              </div>
              {results.slice(0, limit).map(({ note, cards, path }) => {
                const st = status(cards, now);
                const sel = selected.has(note.id);
                const lapses = Math.max(0, ...cards.map((c) => c.lapses));
                return (
                  <div
                    key={note.id}
                    className={cx('group flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0', openId === note.id ? 'bg-accent-soft' : sel ? 'bg-surface-2' : 'hover:bg-surface-2/50')}
                  >
                    <button onClick={() => toggle(note.id)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-faint hover:text-ink" aria-label="Select">
                      {sel ? <CheckSquare className="size-[18px] text-accent-strong" /> : <Square className="size-[18px] opacity-50 group-hover:opacity-100" />}
                    </button>
                    <button onClick={() => (selected.size ? toggle(note.id) : open(note.id))} className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-[15px] font-medium">
                        {note.type === 'word' ? <GenderWord word={note.fields.german ?? ''} gender={note.fields.gender} /> : noteTitle(note)}
                      </span>
                      <span className="truncate text-[13px] text-muted">{noteSubtitle(note)}</span>
                    </button>
                    <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                      <Chip className="max-w-48 truncate">{path.split('::').slice(-2).join(' › ')}</Chip>
                      {note.tags.length > 0 && <span className="max-w-48 truncate text-[11px] text-faint">{note.tags.map((t) => `#${t}`).join(' ')}</span>}
                    </div>
                    <div className="w-20 shrink-0 text-right">
                      <span className="text-[12.5px] font-semibold" style={{ color: st.color }}>
                        {st.label}
                      </span>
                      {lapses >= 3 && <div className="text-[11px] text-again">{lapses} lapses</div>}
                    </div>
                  </div>
                );
              })}
              {results.length > limit && (
                <div className="p-3 text-center">
                  <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                    Show more ({results.length - limit} left)
                  </Button>
                </div>
              )}
            </Panel>
          )}
        </div>

        {openId && wide && (
          <div className="min-w-0">
            <Panel className="sticky top-6 max-h-[calc(100vh-48px)] overflow-y-auto p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[12px] font-semibold tracking-wide text-faint uppercase">Edit</span>
                <IconButton label="Close" onClick={() => setOpenId(null)}>
                  <X className="size-5" />
                </IconButton>
              </div>
              <NoteEditor key={openId} noteId={openId} embedded onSaved={() => undefined} />
            </Panel>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="pb-safe fixed inset-x-0 bottom-[calc(64px+var(--safe-bottom))] z-30 flex justify-center px-3 md:bottom-6">
          <div className="anim-in flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-line bg-surface p-1.5 shadow-2xl">
            <span className="px-2 text-[13px] font-semibold">{selected.size}</span>
            <Button size="sm" variant="ghost" icon={<FolderInput className="size-4" />} onClick={() => setMoveOpen(true)}>
              Move
            </Button>
            <Button size="sm" variant="ghost" icon={<Tag className="size-4" />} onClick={() => setTagOpen(true)}>
              Tag
            </Button>
            <Button size="sm" variant="ghost" icon={<Pause className="size-4" />} onClick={async () => { await suspendNotes(ids, true); toast.success('Suspended'); }}>
              Suspend
            </Button>
            <Button size="sm" variant="ghost" icon={<Play className="size-4" />} onClick={async () => { await suspendNotes(ids, false); toast.success('Unsuspended'); }}>
              Resume
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-4" />}
              onClick={async () => {
                if (!(await confirm(`Reset ${ids.length} notes?`, { body: 'Their cards become new again (review history is kept).', confirm: 'Reset' }))) return;
                await forgetNotes(ids);
                toast.success('Reset');
              }}
            >
              Reset
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Brain className="size-4" />}
              onClick={() => {
                try {
                  sessionStorage.setItem('anker-cram-ids', JSON.stringify(ids));
                } catch {
                  // ignore
                }
                navigate('/study?mode=cram&sel=1');
              }}
            >
              Practice
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-again"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (!(await confirm(`Delete ${ids.length} notes?`, { body: 'Notes, cards and their review history are removed on all devices.', confirm: 'Delete', danger: true }))) return;
                await deleteNotes(ids);
                setSelected(new Set());
                if (openId && selected.has(openId)) setOpenId(null);
                toast.success('Deleted');
              }}
            >
              Delete
            </Button>
            <IconButton label="Clear selection" onClick={() => setSelected(new Set())}>
              <X className="size-4" />
            </IconButton>
          </div>
        </div>
      )}

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Move ${selected.size} notes`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!moveTo}
              onClick={async () => {
                await moveNotes(ids, moveTo!);
                setMoveOpen(false);
                toast.success('Moved');
              }}
            >
              Move
            </Button>
          </>
        }
      >
        <DeckSelect value={moveTo} onChange={setMoveTo} />
      </Modal>
      <Modal
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        title={`Add tags to ${selected.size} notes`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newTags.length}
              onClick={async () => {
                await tagNotes(ids, newTags);
                setTagOpen(false);
                setNewTags([]);
                toast.success('Tagged');
              }}
            >
              Add tags
            </Button>
          </>
        }
      >
        <TagInput value={newTags} onChange={setNewTags} />
      </Modal>
      {confirmNode}
    </div>
  );
}
