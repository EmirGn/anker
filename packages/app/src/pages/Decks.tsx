import type { DeckCounts, DeckNode } from '@anker/core';
import { useState } from 'react';
import { DeckCover } from '../components/DeckCover';
import { ChevronRight, FolderPlus, Import, Plus } from '../components/icons';
import { Button, cx, Empty, Input, Label, Modal, PageHeader, Panel, Spinner, toast } from '../components/ui';
import { db } from '../lib/db';
import { useDeckCounts, useDeckTree, useLiveQuery } from '../lib/hooks';
import { createDeckPath } from '../lib/repo';
import { Link, navigate } from '../lib/router';
import { tr } from '../lib/i18n';

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
    <span className={cx('w-14 text-right tabular-nums', !n && 'opacity-30')} style={{ color: n ? color : undefined }} title={tr(label)}>
      {n}
    </span>
  );
  return (
    <div className={cx('flex gap-1 text-[15px] font-bold', className)}>
      {cell(c.new, 'var(--hafen)', 'Neu')}
      {cell(c.learn, 'var(--koralle-ink)', 'In Arbeit')}
      {cell(c.review, 'var(--wiese)', 'Fällig')}
    </div>
  );
}

export function NewDeckModal({ open, onClose, parentPath }: { open: boolean; onClose: () => void; parentPath?: string }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const path = parentPath ? `${parentPath}::${name.trim()}` : name.trim();
      const d = await createDeckPath(path, { description: desc.trim() || undefined });
      toast.success(tr('„{0}“ erstellt', d.name));
      setName('');
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
      title={parentPath ? tr('Neues Deck in {0}', parentPath.split('::').pop()) : tr('Neues Deck')}
      footer={
        <>
          <Button onClick={onClose}>{tr('Abbrechen')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim()}>{tr('Erstellen')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label hint={tr('Mit :: für Unterdecks')}>{tr('Name')}</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Küche & Kochen')} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div>
          <Label>{tr('Beschreibung')}</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={tr('Optional')} />
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
      <div className="flex items-center gap-2 border-b border-line py-2.5 pr-3 last:border-b-0 md:pr-4" style={{ paddingLeft: `${8 + node.depth * 22}px` }}>
        <button
          onClick={() => hasKids && toggle(node.deck.id)}
          className={cx('flex size-7 shrink-0 items-center justify-center rounded-xs text-ink-muted', hasKids ? 'hover:bg-paper-sunk' : 'invisible')}
          aria-label={isCollapsed ? tr('Aufklappen') : tr('Zuklappen')}
        >
          <ChevronRight className={cx('size-4 transition-transform duration-200', !isCollapsed && 'rotate-90')} />
        </button>
        <Link to={`/decks/${node.deck.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <DeckCover deck={node.deck} size="xs" />
          <div className="min-w-0">
            <div className="t-label truncate" lang="de">
              {node.deck.name}
            </div>
            <div className="t-caption truncate text-ink-muted">
              {notes === 1 ? tr('1 Notiz') : tr('{0} Notizen', notes)}
              {node.deck.description ? ` · ${node.deck.description}` : ''}
            </div>
          </div>
        </Link>
        <Counts c={c} className="hidden sm:flex" />
        <Button size="sm" variant={total ? 'secondary' : 'ghost'} onClick={() => navigate(`/study/${node.deck.id}`)} disabled={!total} className="ml-1 w-[76px]">
          {total ? tr('Lernen') : tr('Fertig')}
        </Button>
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
  const empty = tree?.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-5 pt-8 pb-10 md:px-8 md:pt-10">
      <PageHeader
        title={tr('Decks')}
        subtitle={tr('Deine Kartenstapel. Unterdecks zählen zu ihrem Oberdeck.')}
        actions={
          <>
            <Button onClick={() => navigate('/import')} icon={<Import className="size-5" />} className="hidden sm:inline-flex">{tr('Importieren')}</Button>
            <Button variant={empty ? 'secondary' : 'primary'} onClick={() => setNewOpen(true)} icon={<FolderPlus className="size-5" />}>{tr('Neues Deck')}</Button>
          </>
        }
      />
      {!tree || !counts || !noteCounts ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : empty ? (
        <Panel>
          <Empty
            title={tr('Noch keine Decks')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => navigate('/welcome')}>{tr('Starter-Decks holen')}</Button>
                <Button onClick={() => setNewOpen(true)} icon={<Plus className="size-5" />}>{tr('Deck erstellen')}</Button>
                <Button onClick={() => navigate('/import')}>{tr('Aus Anki importieren')}</Button>
              </div>
            }
          >{tr('Starte mit einem deutschen Starter-Deck, erstelle ein eigenes oder bring deine Anki-Decks mit.')}</Empty>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="t-overline hidden items-center justify-end gap-1 border-b whitespace-nowrap hyphens-none border-line px-4 py-2 text-ink-muted sm:flex">
            <span className="w-14 text-right">{tr('Neu')}</span>
            <span className="w-14 text-right">{tr('Lernend')}</span>
            <span className="w-14 text-right">{tr('Fällig')}</span>
            <span className="w-[84px]" />
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
