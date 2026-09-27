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
import { ArrowLeft, Brain, FolderPlus, Plus, Search, Trash2 } from '../components/icons';
import { useMemo, useState } from 'react';
import { Bars, StackedBar } from '../components/charts';
import { DeckSelect } from '../components/DeckSelect';
import { DeckCover } from '../components/DeckCover';
import { Button, cx, Empty, Input, Label, Panel, Section, Segmented, Spinner, toast, Toggle, useConfirm } from '../components/ui';
import { db } from '../lib/db';
import { useDeckCounts, useDecks, useLiveQuery, usePrefs } from '../lib/hooks';
import { deleteDeck, updateDeck, updateDeckConfig } from '../lib/repo';
import { Link, navigate } from '../lib/router';
import { NewDeckModal } from './Decks';

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
  const set = (patch: Partial<DeckConfig>) => void updateDeckConfig(deckId, patch).then(() => toast.success('Gespeichert'));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="Neue Karten pro Tag" value={cfg.newPerDay} onChange={(v) => set({ newPerDay: v })} />
        <NumberField label="Wiederholungen pro Tag" value={cfg.reviewsPerDay} onChange={(v) => set({ reviewsPerDay: v })} max={99999} />
      </div>
      <div>
        <Label hint={`${Math.round(cfg.desiredRetention * 100)} %`}>Gewünschte Behaltensquote (FSRS)</Label>
        <input
          type="range"
          min={0.75}
          max={0.97}
          step={0.01}
          defaultValue={cfg.desiredRetention}
          onMouseUp={(e) => set({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => set({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
          onKeyUp={(e) => set({ desiredRetention: Number((e.target as HTMLInputElement).value) })}
          className="w-full accent-[var(--hafen)]"
        />
        <p className="mt-1 text-[13px] text-ink-muted">Höher heißt: du behältst mehr, wiederholst aber öfter. 90 % ist ein guter Standard.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <StepsField label="Lernschritte" value={cfg.learningSteps} onChange={(v) => set({ learningSteps: v })} hint="z. B. 1m 10m" />
        <StepsField label="Wiederlernschritte" value={cfg.relearningSteps} onChange={(v) => set({ relearningSteps: v })} hint="z. B. 10m" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="Maximales Intervall (Tage)" value={cfg.maximumInterval} onChange={(v) => set({ maximumInterval: v })} min={1} max={36500} />
        <NumberField label="„Oft vergessen“ ab (Fehlern)" value={cfg.leechThreshold} onChange={(v) => set({ leechThreshold: v })} min={1} max={99} />
      </div>
      <div>
        <Label>Reihenfolge neuer Karten</Label>
        <Segmented
          value={cfg.newOrder}
          onChange={(v) => set({ newOrder: v })}
          options={[
            { value: 'added', label: 'Wie hinzugefügt' },
            { value: 'random', label: 'Zufällig' },
          ]}
        />
      </div>
      <div className="divide-y divide-line rounded-md border border-line">
        {(
          [
            ['autoSpeak', 'Deutsch automatisch vorlesen', 'Liest Wörter und Sätze vor, sobald sie erscheinen.'],
            ['typeAnswer', 'Antwort tippen bei EN→DE-Karten', 'Prüft deine Schreibweise (Umlaute, Großschreibung, Artikel).'],
            ['burySiblings', 'Eine Karte pro Wort und Tag', 'Versteckt die Rückrichtung eines Wortes bis morgen.'],
          ] as const
        ).map(([key, title, desc]) => (
          <div key={key} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="t-label">{title}</div>
              <div className="t-caption text-ink-muted">{desc}</div>
            </div>
            <Toggle checked={cfg[key]} onChange={(v) => set({ [key]: v } as Partial<DeckConfig>)} label={title} />
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void updateDeck(deckId, { config: {} }).then(() => toast.success('Optionen zurückgesetzt'))}
      >
        Auf Standard zurücksetzen
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
      <Empty title="Deck nicht gefunden" mood="thinking" action={<Button onClick={() => navigate('/decks')}>Zurück zu den Decks</Button>}>
        Vielleicht wurde es auf einem anderen Gerät gelöscht.
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
    <div className="mx-auto max-w-4xl px-5 pt-6 pb-12 md:px-8 md:pt-10">
      <Link to="/decks" className="t-label mb-5 inline-flex h-9 items-center gap-1.5 text-ink-muted hover:text-ink">
        <ArrowLeft className="size-5" /> Decks
      </Link>
      <div className="mb-6 flex items-end gap-5">
        <DeckCover deck={deck} size="lg" />
        <div className="min-w-0 flex-1 pb-1">
          <div className="t-overline truncate text-ink-muted">{['Deck', ...path.split('::').slice(0, -1)].join(' · ')}</div>
          <h1 className="t-title mt-1.5 break-words" lang="de">
            {deck.name}
          </h1>
          <div className="t-caption mt-1.5 text-ink-muted">
            {data ? `${data.notes} ${data.notes === 1 ? 'Notiz' : 'Notizen'} · ` : ''}
            {total} fällig
          </div>
          {deck.description && <p className="mt-2 text-[15px] text-ink-muted">{deck.description}</p>}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_1.4fr] gap-2">
        <Button size="lg" onClick={() => navigate(`/study?mode=cram&q=${encodeURIComponent(`deck:"${path}"`)}`)} icon={<Brain className="size-5" />}>
          Alle üben
        </Button>
        <Button variant="primary" size="lg" disabled={!total} onClick={() => navigate(`/study/${id}`)}>
          {total ? 'Lernen' : 'Alles erledigt'}
        </Button>
      </div>
      {c && (
        <p className="t-caption mb-6 text-center text-ink-muted tabular-nums">
          <span className="font-bold text-hafen">{c.new}</span> neu · <span className="font-bold text-koralle-ink">{c.learn}</span> in Arbeit ·{' '}
          <span className="font-bold text-wiese">{c.review}</span> fällig
        </p>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Übersicht' },
            { value: 'options', label: 'Optionen' },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate(`/add?deck=${id}`)} icon={<Plus className="size-4" />}>
            Karten hinzufügen
          </Button>
          <Button size="sm" onClick={() => navigate(`/browse?q=${encodeURIComponent(`deck:"${path}"`)}`)} icon={<Search className="size-4" />}>
            Durchsuchen
          </Button>
          <Button size="sm" onClick={() => setSubOpen(true)} icon={<FolderPlus className="size-4" />}>
            Unterdeck
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
            <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-md border border-line bg-paper-raised text-center md:grid-cols-4">
              {[
                ['Notizen', data.notes.toLocaleString('de-DE')],
                ['Karten', breakdown.total.toLocaleString('de-DE')],
                ['Behalten (30 T.)', ret?.rate == null ? '–' : `${Math.round(ret.rate * 100)} %`],
                ['Wiederholungen', data.logs.length.toLocaleString('de-DE')],
              ].map(([k, v], i) => (
                <div key={k} className={cx('px-2 py-3', i % 2 === 1 && 'border-l border-line', i > 1 && 'border-t border-line md:border-t-0', i === 2 && 'md:border-l')}>
                  <div className="t-stat">{v}</div>
                  <div className="t-caption text-ink-muted">{k}</div>
                </div>
              ))}
            </div>
            <Section title="Karten">
              <Panel className="p-5">
                <StackedBar
                  parts={[
                    { label: 'Neu', value: breakdown.new, color: 'var(--hafen)' },
                    { label: 'In Arbeit', value: breakdown.learning, color: 'var(--koralle-ink)' },
                    { label: 'Jung', value: breakdown.young, color: 'color-mix(in srgb, var(--wiese) 55%, var(--line))' },
                    { label: 'Gefestigt', value: breakdown.mature, color: 'var(--wiese)' },
                    { label: 'Ausgesetzt', value: breakdown.suspended, color: 'var(--sonne-ink)' },
                  ]}
                />
              </Panel>
            </Section>
            <Section title="Nächste 14 Tage">
              <Panel className="p-5">
                <Bars values={fc} labels={fc.map((_, i) => (i === 0 ? 'Heute' : i % 2 === 0 ? `+${i}` : null))} height={100} color="var(--wiese)" format={(v) => `${v} fällig`} />
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
              <div>
                <Label>Beschreibung</Label>
                <Input defaultValue={deck.description ?? ''} onBlur={(e) => void updateDeck(id, { description: e.target.value.trim() || undefined })} />
              </div>
              <div>
                <Label>Oberdeck</Label>
                <DeckSelect
                  value={deck.parentId}
                  allowNone
                  noneLabel="– Oberste Ebene –"
                  onChange={(pid) => {
                    if (pid === id) return;
                    updateDeck(id, { parentId: pid }).then(
                      () => toast.success('Verschoben'),
                      (e) => toast.error((e as Error).message),
                    );
                  }}
                />
              </div>
            </Panel>
            <Panel className="p-5">
              <div className="t-label">Deck löschen</div>
              <p className="mt-1 text-[15px] text-ink-muted">Löscht dieses Deck, seine Unterdecks und alle Karten samt Lernverlauf – auf jedem synchronisierten Gerät.</p>
              <Button
                variant="danger"
                className="mt-3"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  const ok = await confirm(`„${deck.name}“ löschen?`, {
                    body: `Das entfernt ${ids.size} Deck(s) und ${data?.notes ?? 0} Notizen endgültig.`,
                    confirm: 'Löschen',
                    danger: true,
                  });
                  if (!ok) return;
                  await deleteDeck(id);
                  toast.success('Deck gelöscht');
                  navigate('/decks');
                }}
              >
                Deck löschen
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
