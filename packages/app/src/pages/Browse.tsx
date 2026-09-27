import {
  CardState,
  deckPath,
  matchesQuery,
  nextDayStartMs,
  noteSubtitle,
  noteTitle,
  parseQuery,
  DAY,
  type Card,
  type Deck,
  type Note,
} from '@anker/core';
import { Brain, CheckSquare, FolderInput, Pause, Play, RotateCcw, Search, Square, Tag, Trash2, X } from '../components/icons';
import { useEffect, useMemo, useState } from 'react';
import { GenderWord } from '../components/CardView';
import { DeckSelect } from '../components/DeckSelect';
import { TagInput } from '../components/TagInput';
import { Button, Chip, cx, Empty, IconButton, Modal, PageHeader, Panel, Select, Spinner, toast, useConfirm } from '../components/ui';
import { db } from '../lib/db';
import { relativ } from '../lib/format';
import { useIsWide, useLiveQuery, usePrefs } from '../lib/hooks';
import { deleteNotes, forgetNotes, moveNotes, suspendNotes, tagNotes } from '../lib/repo';
import { navigate, useRoute } from '../lib/router';
import { NoteEditor } from './Editor';

const FILTERS = [
  { label: 'Fällig', q: 'is:due' },
  { label: 'Neu', q: 'is:new' },
  { label: 'Nomen', q: 'pos:noun' },
  { label: 'Verben', q: 'pos:verb' },
  { label: 'Oft vergessen', q: 'is:leech' },
  { label: 'Ausgesetzt', q: 'is:suspended' },
  { label: 'Diese Woche neu', q: 'added:7' },
  { label: 'Heute wiederholt', q: 'rated:1' },
];

type SortKey = 'new' | 'alpha' | 'due' | 'lapses';

function status(cards: Card[], now: number): { label: string; color?: string } {
  if (!cards.length) return { label: '–' };
  if (cards.every((c) => c.suspended)) return { label: 'Ausgesetzt', color: 'var(--ink-muted)' };
  const active = cards.filter((c) => !c.suspended);
  if (active.every((c) => c.state === CardState.New)) return { label: 'Neu', color: 'var(--hafen)' };
  const due = Math.min(...active.filter((c) => c.state !== CardState.New).map((c) => c.due));
  if (due <= now) return { label: 'Fällig', color: 'var(--wiese)' };
  return { label: relativ(due, now) };
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
    <div className={cx('mx-auto px-5 pt-8 pb-24 md:px-8 md:pt-10', openId && wide ? 'max-w-[1400px]' : 'max-w-5xl')}>
      <PageHeader title="Karten suchen" subtitle={results ? `${results.length.toLocaleString('de-DE')} ${results.length === 1 ? 'Notiz' : 'Notizen'}` : ' '} />
      <div className={cx(openId && wide && 'grid grid-cols-[1fr_520px] gap-6')}>
        <div className="min-w-0">
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder='Suchen …  z. B. haus deck:"Deutsch::A1" gender:die is:due'
                className="h-11 w-full rounded-md border border-transparent bg-paper-sunk pr-10 pl-11 text-[15px] outline-none placeholder:text-ink-muted focus:border-hafen focus:bg-paper-raised"
              />
              {q && (
                <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-xs p-1 text-ink-muted hover:text-ink" aria-label="Suche leeren">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-36 shrink-0">
              <option value="new">Neueste</option>
              <option value="alpha">A–Z</option>
              <option value="due">Fälligkeit</option>
              <option value="lapses">Meiste Fehler</option>
            </Select>
          </div>
          <div className="thin-scroll -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {FILTERS.map((f) => {
              const active = q.split(/\s+/).includes(f.q);
              return (
                <button
                  key={f.q}
                  onClick={() => toggleFilter(f.q)}
                  className={cx('h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors duration-[120ms]', active ? 'border-transparent bg-ink text-paper' : 'border-line bg-paper-raised text-ink-muted hover:bg-paper-sunk')}
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
              <Empty mood="thinking" title="Nichts gefunden">
                Versuch weniger Wörter oder Suchbefehle wie <code className="rounded-xs bg-paper-sunk px-1">tag:A2</code>, <code className="rounded-xs bg-paper-sunk px-1">is:leech</code> oder <code className="rounded-xs bg-paper-sunk px-1">-is:suspended</code>.
              </Empty>
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                <IconButton
                  label={selected.size ? 'Auswahl aufheben' : 'Alle angezeigten auswählen'}
                  className="size-8"
                  onClick={() => setSelected(selected.size ? new Set() : new Set(results.slice(0, limit).map((r) => r.note.id)))}
                >
                  {selected.size ? <CheckSquare className="size-[18px] text-hafen" /> : <Square className="size-[18px]" />}
                </IconButton>
                <span className="text-[13px] text-ink-muted">{selected.size ? `${selected.size} ausgewählt` : 'Auswählen, um mehrere auf einmal zu bearbeiten'}</span>
              </div>
              {results.slice(0, limit).map(({ note, cards, path }) => {
                const st = status(cards, now);
                const sel = selected.has(note.id);
                const lapses = Math.max(0, ...cards.map((c) => c.lapses));
                return (
                  <div
                    key={note.id}
                    className={cx('group flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0', openId === note.id ? 'bg-hafen-soft' : sel ? 'bg-paper-sunk' : 'hover:bg-paper-sunk/50')}
                  >
                    <button onClick={() => toggle(note.id)} className="flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:text-ink" aria-label="Auswählen">
                      {sel ? <CheckSquare className="size-[18px] text-hafen" /> : <Square className="size-[18px] opacity-50 group-hover:opacity-100" />}
                    </button>
                    <button onClick={() => (selected.size ? toggle(note.id) : open(note.id))} className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-[15px] font-medium">
                        {note.type === 'word' ? <GenderWord word={note.fields.german ?? ''} gender={note.fields.gender} /> : noteTitle(note)}
                      </span>
                      <span className="truncate text-[13px] text-ink-muted">{noteSubtitle(note)}</span>
                    </button>
                    <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                      <Chip className="max-w-48 truncate">{path.split('::').slice(-2).join(' › ')}</Chip>
                      {note.tags.length > 0 && <span className="max-w-48 truncate text-[11px] text-ink-muted">{note.tags.map((t) => `#${t}`).join(' ')}</span>}
                    </div>
                    <div className="w-20 shrink-0 text-right">
                      <span className="text-[13px] font-semibold" style={{ color: st.color }}>
                        {st.label}
                      </span>
                      {lapses >= 3 && <div className="text-[11px] font-semibold text-koralle-ink">{lapses} Fehler</div>}
                    </div>
                  </div>
                );
              })}
              {results.length > limit && (
                <div className="p-3 text-center">
                  <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                    Mehr zeigen (noch {results.length - limit})
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
                <span className="t-overline text-ink-muted">Bearbeiten</span>
                <IconButton label="Schließen" onClick={() => setOpenId(null)}>
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
          <div className="anim-in flex max-w-full flex-wrap items-center justify-center gap-1 rounded-md border border-line bg-paper-raised p-1.5 shadow-2xl">
            <span className="px-2 text-[13px] font-semibold">{selected.size}</span>
            <Button size="sm" variant="ghost" icon={<FolderInput className="size-4" />} onClick={() => setMoveOpen(true)}>
              Verschieben
            </Button>
            <Button size="sm" variant="ghost" icon={<Tag className="size-4" />} onClick={() => setTagOpen(true)}>
              Tags
            </Button>
            <Button size="sm" variant="ghost" icon={<Pause className="size-4" />} onClick={async () => { await suspendNotes(ids, true); toast.success('Ausgesetzt'); }}>
              Aussetzen
            </Button>
            <Button size="sm" variant="ghost" icon={<Play className="size-4" />} onClick={async () => { await suspendNotes(ids, false); toast.success('Wieder aktiv'); }}>
              Aktivieren
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-4" />}
              onClick={async () => {
                if (!(await confirm(`${ids.length} Notizen zurücksetzen?`, { body: 'Ihre Karten werden wieder neu (der Lernverlauf bleibt erhalten).', confirm: 'Zurücksetzen' }))) return;
                await forgetNotes(ids);
                toast.success('Zurückgesetzt');
              }}
            >
              Zurücksetzen
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
              Üben
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-koralle-ink"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (!(await confirm(`${ids.length} Notizen löschen?`, { body: 'Notizen, Karten und ihr Lernverlauf werden auf allen Geräten entfernt.', confirm: 'Löschen', danger: true }))) return;
                await deleteNotes(ids);
                setSelected(new Set());
                if (openId && selected.has(openId)) setOpenId(null);
                toast.success('Gelöscht');
              }}
            >
              Löschen
            </Button>
            <IconButton label="Auswahl aufheben" onClick={() => setSelected(new Set())}>
              <X className="size-4" />
            </IconButton>
          </div>
        </div>
      )}

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`${selected.size} Notizen verschieben`}
        footer={
          <>
            <Button onClick={() => setMoveOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={!moveTo}
              onClick={async () => {
                await moveNotes(ids, moveTo!);
                setMoveOpen(false);
                toast.success('Verschoben');
              }}
            >
              Verschieben
            </Button>
          </>
        }
      >
        <DeckSelect value={moveTo} onChange={setMoveTo} />
      </Modal>
      <Modal
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        title={`Tags für ${selected.size} Notizen`}
        footer={
          <>
            <Button onClick={() => setTagOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={!newTags.length}
              onClick={async () => {
                await tagNotes(ids, newTags);
                setTagOpen(false);
                setNewTags([]);
                toast.success('Tags hinzugefügt');
              }}
            >
              Tags hinzufügen
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
