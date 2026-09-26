import type { DeckCounts, DeckNode } from '@anker/core';
import { ChevronRight, FolderPlus, Import, Library, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, cx, Empty, Input, Label, Modal, PageHeader, Panel, Spinner, toast } from '../components/ui';
import { db } from '../lib/db';
import { useDeckCounts, useDeckTree, useLiveQuery } from '../lib/hooks';
import { createDeckPath } from '../lib/repo';
import { Link, navigate } from '../lib/router';

const COLLAPSE_KEY = 'anker-collapsed';
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function Counts({ c, className }: { c?: DeckCounts; className?: string }) {
  if (!c) return null;
  const cell = (n: number, color: string, label: string) => (
    <span className={cx('w-8 text-right tabular-nums', !n && 'opacity-30')} style={{ color: n ? color : undefined }} title={label}>
      {n}
    </span>
  );
  return (
    <div className={cx('flex gap-1 text-[13.5px] font-semibold', className)}>
      {cell(c.new, 'var(--easy)', 'New')}
      {cell(c.learn, 'var(--again)', 'Learning')}
      {cell(c.review, 'var(--good)', 'Review')}
    </div>
  );
}

export function NewDeckModal({ open, onClose, parentPath }: { open: boolean; onClose: () => void; parentPath?: string }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const path = parentPath ? `${parentPath}::${name.trim()}` : name.trim();
      const d = await createDeckPath(path, { emoji: emoji.trim() || undefined, description: desc.trim() || undefined });
      toast.success(`Created “${d.name}”`);
      setName('');
      setEmoji('');
      setDesc('');
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parentPath ? `New deck in ${parentPath.split('::').pop()}` : 'New deck'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="w-20">
            <Label>Emoji</Label>
            <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🍳" maxLength={4} className="text-center text-lg" />
          </div>
          <div className="flex-1">
            <Label hint="Use :: for sub-decks">Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Küche & Kochen" onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
        </div>
      </div>
    </Modal>
  );
}

function DeckRow({
  node,
  counts,
  noteCounts,
  collapsed,
  toggle,
}: {
  node: DeckNode;
  counts: Map<string, DeckCounts>;
  noteCounts: Map<string, number>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const c = counts.get(node.deck.id);
  const hasKids = node.children.length > 0;
  const isCollapsed = collapsed.has(node.deck.id);
  const total = c ? c.new + c.learn + c.review : 0;
  const notes = noteCounts.get(node.deck.id) ?? 0;
  return (
    <>
      <div className="group flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-surface-2/50 md:px-4" style={{ paddingLeft: `${12 + node.depth * 22}px` }}>
        <button
          onClick={() => hasKids && toggle(node.deck.id)}
          className={cx('flex size-6 shrink-0 items-center justify-center rounded-md text-faint', hasKids ? 'hover:bg-surface-3' : 'invisible')}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronRight className={cx('size-4 transition-transform', !isCollapsed && 'rotate-90')} />
        </button>
        <Link to={`/decks/${node.deck.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg">{node.deck.emoji ?? (node.depth ? '📁' : '📚')}</span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">{node.deck.name}</div>
            <div className="truncate text-[12px] text-faint">
              {notes} {notes === 1 ? 'note' : 'notes'}
              {node.deck.description ? ` · ${node.deck.description}` : ''}
            </div>
          </div>
        </Link>
        <Counts c={c} className="hidden sm:flex" />
        <Button size="sm" variant={total ? 'primary' : 'ghost'} onClick={() => navigate(`/study/${node.deck.id}`)} disabled={!total} className="ml-1 w-[72px]">
          {total ? 'Study' : 'Done'}
        </Button>
        <Link to={`/decks/${node.deck.id}`} className="flex size-8 items-center justify-center rounded-lg text-faint hover:bg-surface-3 hover:text-ink" aria-label="Deck options">
          <MoreHorizontal className="size-4" />
        </Link>
      </div>
      {!isCollapsed && node.children.map((ch) => <DeckRow key={ch.deck.id} node={ch} counts={counts} noteCounts={noteCounts} collapsed={collapsed} toggle={toggle} />)}
    </>
  );
}

export function Decks() {
  const tree = useDeckTree();
  const counts = useDeckCounts();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [newOpen, setNewOpen] = useState(false);
  const noteCounts = useLiveQuery(async () => {
    const [notes, decks] = await Promise.all([db.notes.toArray(), db.decks.toArray()]);
    const own = new Map<string, number>();
    for (const n of notes) own.set(n.deckId, (own.get(n.deckId) ?? 0) + 1);
    const kids = new Map<string, string[]>();
    for (const d of decks) if (d.parentId) kids.set(d.parentId, [...(kids.get(d.parentId) ?? []), d.id]);
    const total = new Map<string, number>();
    const sum = (id: string, seen: Set<string>): number => {
      if (seen.has(id)) return 0;
      seen.add(id);
      const v = (own.get(id) ?? 0) + (kids.get(id) ?? []).reduce((s, k) => s + sum(k, seen), 0);
      total.set(id, v);
      return v;
    };
    for (const d of decks) if (!total.has(d.id)) sum(d.id, new Set());
    return total;
  }, []);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pt-6 pb-10 md:px-8 md:pt-10">
      <PageHeader
        title="Decks"
        subtitle="Your Kartenstapel. Sub-decks count toward their parent."
        actions={
          <>
            <Button onClick={() => navigate('/import')} icon={<Import className="size-4" />} className="hidden sm:inline-flex">
              Import
            </Button>
            <Button variant="primary" onClick={() => setNewOpen(true)} icon={<FolderPlus className="size-4" />}>
              New deck
            </Button>
          </>
        }
      />
      {!tree || !counts || !noteCounts ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : tree.length === 0 ? (
        <Panel>
          <Empty
            icon={<Library className="size-7" />}
            title="No decks yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => navigate('/welcome')}>
                  Get starter decks
                </Button>
                <Button onClick={() => setNewOpen(true)} icon={<Plus className="size-4" />}>
                  Create a deck
                </Button>
                <Button onClick={() => navigate('/import')}>Import from Anki</Button>
              </div>
            }
          >
            Start with a curated German deck, create your own, or bring your Anki decks along.
          </Empty>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="hidden items-center justify-end gap-1 border-b border-line bg-surface-2/40 px-4 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase sm:flex">
            <span className="w-8 text-right">New</span>
            <span className="w-8 text-right">Learn</span>
            <span className="w-8 text-right">Due</span>
            <span className="w-[112px]" />
          </div>
          {tree.map((n) => (
            <DeckRow key={n.deck.id} node={n} counts={counts} noteCounts={noteCounts} collapsed={collapsed} toggle={toggle} />
          ))}
        </Panel>
      )}
      <NewDeckModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
