import {
  cardBreakdown,
  deckPath,
  forecast,
  resolveDeckConfig,
  retention,
  subtreeIds,
  DAY,
  type DeckConfig,
} from '@anker/core';
import { ArrowLeft, Brain, FolderPlus, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bars, StackedBar } from '../components/charts';
import { DeckSelect } from '../components/DeckSelect';
import { Button, Empty, Input, Label, Panel, Section, Segmented, Spinner, toast, Toggle, useConfirm } from '../components/ui';
import { db } from '../lib/db';
import { useDeckCounts, useDecks, useLiveQuery, usePrefs } from '../lib/hooks';
import { deleteDeck, updateDeck, updateDeckConfig } from '../lib/repo';
import { Link, navigate } from '../lib/router';
import { Counts, NewDeckModal } from './Decks';

function NumberField({ label, value, onChange, min = 0, max = 9999, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; hint?: string }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.max(min, Math.min(max, Math.round(Number(draft))));
          if (Number.isFinite(n)) {
            setDraft(String(n));
            if (n !== value) onChange(n);
          } else setDraft(String(value));
        }}
      />
    </div>
  );
}

function StepsField({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  const [draft, setDraft] = useState(value.join(' '));
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const steps = draft.split(/[\s,]+/).filter((s) => /^\d+(\.\d+)?[mhd]$/.test(s));
          setDraft(steps.join(' '));
          if (steps.join(' ') !== value.join(' ')) onChange(steps);
        }}
        placeholder="1m 10m"
      />
    </div>
  );
}

function Options({ deckId, cfg }: { deckId: string; cfg: DeckConfig }) {
  const set = (patch: Partial<DeckConfig>) => void updateDeckConfig(deckId, patch).then(() => toast.success('Saved'));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="New cards / day" value={cfg.newPerDay} onChange={(v) => set({ newPerDay: v })} />
        <NumberField label="Reviews / day" value={cfg.reviewsPerDay} onChange={(v) => set({ reviewsPerDay: v })} max={99999} />
      </div>
      <div>
        <Label hint={`${Math.round(cfg.desiredRetention * 100)}%`}>Desired retention (FSRS)</Label>
        <input
          type="range"
          min={0.75}
          max={0.97}
          step={0.01}
          defaultValue={cfg.desiredRetention}
          onMouseUp={(e) => set({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => set({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
          onKeyUp={(e) => set({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
          className="w-full accent-[var(--accent)]"
        />
        <p className="mt-1 text-xs text-faint">Higher = you remember more, but review more often. 90% is a great default.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <StepsField label="Learning steps" value={cfg.learningSteps} onChange={(v) => set({ learningSteps: v })} hint="e.g. 1m 10m" />
        <StepsField label="Relearning steps" value={cfg.relearningSteps} onChange={(v) => set({ relearningSteps: v })} hint="e.g. 10m" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="Maximum interval (days)" value={cfg.maximumInterval} onChange={(v) => set({ maximumInterval: v })} min={1} max={36500} />
        <NumberField label="Leech threshold (lapses)" value={cfg.leechThreshold} onChange={(v) => set({ leechThreshold: v })} min={1} max={99} />
      </div>
      <div>
        <Label>New card order</Label>
        <Segmented
          value={cfg.newOrder}
          onChange={(v) => set({ newOrder: v })}
          options={[
            { value: 'added', label: 'In order added' },
            { value: 'random', label: 'Random' },
          ]}
        />
      </div>
      <div className="divide-y divide-line rounded-2xl border border-line">
        {(
          [
            ['autoSpeak', 'Speak German automatically', 'Reads words and sentences aloud when they appear.'],
            ['typeAnswer', 'Type the answer on EN→DE cards', 'Checks your spelling (umlauts, capitals, articles).'],
            ['burySiblings', 'One card per word per day', 'Hides the reverse card of a word until tomorrow.'],
          ] as const
        ).map(([key, title, desc]) => (
          <div key={key} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-medium">{title}</div>
              <div className="text-[12.5px] text-muted">{desc}</div>
            </div>
            <Toggle checked={cfg[key]} onChange={(v) => set({ [key]: v } as Partial<DeckConfig>)} label={title} />
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void updateDeck(deckId, { config: {} }).then(() => toast.success('Options reset to defaults'))}
      >
        Reset to defaults
      </Button>
    </div>
  );
}

export function DeckPage({ id }: { id: string }) {
  const decks = useDecks();
  const counts = useDeckCounts();
  const prefs = usePrefs();
  const [confirm, confirmNode] = useConfirm();
  const [tab, setTab] = useState<'overview' | 'options'>('overview');
  const [subOpen, setSubOpen] = useState(false);
  const deck = decks?.find((d) => d.id === id);
  const byId = useMemo(() => new Map((decks ?? []).map((d) => [d.id, d])), [decks]);
  const ids = useMemo(() => (decks ? subtreeIds(id, decks) : new Set<string>()), [decks, id]);
  const data = useLiveQuery(async () => {
    const list = [...ids];
    const [cards, logs, notes] = await Promise.all([
      db.cards.where('deckId').anyOf(list).toArray(),
      db.revlog.where('deckId').anyOf(list).toArray(),
      db.notes.where('deckId').anyOf(list).count(),
    ]);
    return { cards, logs, notes };
  }, [ids]);

  if (!decks) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!deck)
    return (
      <Empty title="Deck not found" action={<Button onClick={() => navigate('/decks')}>Back to decks</Button>}>
        It may have been deleted on another device.
      </Empty>
    );

  const cfg = resolveDeckConfig(deck, byId);
  const path = deckPath(deck, byId);
  const c = counts?.get(id);
  const total = c ? c.new + c.learn + c.review : 0;
  const breakdown = data ? cardBreakdown(data.cards) : null;
  const ret = data ? retention(data.logs, Date.now() - 30 * DAY) : null;
  const fc = data ? forecast(data.cards, Date.now(), prefs.rolloverHour, 14) : [];

  return (
    <div className="mx-auto max-w-4xl px-4 pt-6 pb-12 md:px-8 md:pt-10">
      <Link to="/decks" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Decks
      </Link>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-surface text-3xl shadow-card">{deck.emoji ?? '📚'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-faint">{path.includes('::') ? path.split('::').slice(0, -1).join(' › ') : 'Deck'}</div>
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight">{deck.name}</h1>
          {deck.description && <p className="mt-1 text-sm text-muted">{deck.description}</p>}
        </div>
      </div>

      <Panel className="mb-6 flex flex-wrap items-center gap-5 p-5">
        <div className="flex-1">
          <div className="text-[13px] text-muted">Due today</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-display text-[40px] leading-none font-semibold tabular-nums">{total}</span>
            <Counts c={c} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate(`/study?mode=cram&q=${encodeURIComponent(`deck:"${path}"`)}`)} icon={<Brain className="size-4" />}>
            Practice all
          </Button>
          <Button variant="primary" size="lg" disabled={!total} onClick={() => navigate(`/study/${id}`)}>
            {total ? 'Study now' : 'All done ✓'}
          </Button>
        </div>
      </Panel>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'options', label: 'Options' },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate(`/add?deck=${id}`)} icon={<Plus className="size-4" />}>
            Add cards
          </Button>
          <Button size="sm" onClick={() => navigate(`/browse?q=${encodeURIComponent(`deck:"${path}"`)}`)} icon={<Search className="size-4" />}>
            Browse
          </Button>
          <Button size="sm" onClick={() => setSubOpen(true)} icon={<FolderPlus className="size-4" />}>
            Sub-deck
          </Button>
        </div>
      </div>

      {tab === 'overview' ? (
        !data || !breakdown ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['Notes', data.notes],
                ['Cards', breakdown.total],
                ['Retention (30d)', ret?.rate == null ? '—' : `${Math.round(ret.rate * 100)}%`],
                ['Reviews', data.logs.length],
              ].map(([k, v]) => (
                <Panel key={k as string} className="px-4 py-3">
                  <div className="text-[12px] text-faint">{k}</div>
                  <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{v}</div>
                </Panel>
              ))}
            </div>
            <Section title="Cards">
              <Panel className="p-5">
                <StackedBar
                  parts={[
                    { label: 'New', value: breakdown.new, color: 'var(--easy)' },
                    { label: 'Learning', value: breakdown.learning, color: 'var(--again)' },
                    { label: 'Young', value: breakdown.young, color: 'color-mix(in srgb, var(--good) 55%, var(--surface-3))' },
                    { label: 'Mature', value: breakdown.mature, color: 'var(--good)' },
                    { label: 'Suspended', value: breakdown.suspended, color: 'var(--hard)' },
                  ]}
                />
              </Panel>
            </Section>
            <Section title="Next 14 days">
              <Panel className="p-5">
                <Bars values={fc} labels={fc.map((_, i) => (i === 0 ? 'Heute' : i % 2 === 0 ? `+${i}` : null))} height={100} color="var(--good)" format={(v) => `${v} due`} />
              </Panel>
            </Section>
          </>
        )
      ) : (
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <Panel className="p-5">
            <Options deckId={id} cfg={cfg} />
          </Panel>
          <div className="space-y-4">
            <Panel className="space-y-4 p-5">
              <div>
                <Label>Name</Label>
                <Input defaultValue={deck.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== deck.name && void updateDeck(id, { name: e.target.value.trim().replace(/::/g, ':') })} />
              </div>
              <div className="flex gap-3">
                <div className="w-20">
                  <Label>Emoji</Label>
                  <Input defaultValue={deck.emoji ?? ''} maxLength={4} className="text-center" onBlur={(e) => void updateDeck(id, { emoji: e.target.value.trim() || undefined })} />
                </div>
                <div className="flex-1">
                  <Label>Description</Label>
                  <Input defaultValue={deck.description ?? ''} onBlur={(e) => void updateDeck(id, { description: e.target.value.trim() || undefined })} />
                </div>
              </div>
              <div>
                <Label>Parent deck</Label>
                <DeckSelect
                  value={deck.parentId}
                  allowNone
                  noneLabel="— Top level —"
                  onChange={(pid) => {
                    if (pid === id) return;
                    updateDeck(id, { parentId: pid }).then(
                      () => toast.success('Moved'),
                      (e) => toast.error((e as Error).message),
                    );
                  }}
                />
              </div>
            </Panel>
            <Panel className="p-5">
              <div className="font-medium">Delete deck</div>
              <p className="mt-1 text-sm text-muted">Deletes this deck, its sub-decks and all their cards and review history — on every synced device.</p>
              <Button
                variant="danger"
                className="mt-3"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  const ok = await confirm(`Delete “${deck.name}”?`, {
                    body: `This removes ${ids.size} deck(s) and ${data?.notes ?? 0} notes permanently.`,
                    confirm: 'Delete',
                    danger: true,
                  });
                  if (!ok) return;
                  await deleteDeck(id);
                  toast.success('Deck deleted');
                  navigate('/decks');
                }}
              >
                Delete deck
              </Button>
            </Panel>
          </div>
        </div>
      )}
      <NewDeckModal open={subOpen} onClose={() => setSubOpen(false)} parentPath={path} />
      {confirmNode}
    </div>
  );
}
