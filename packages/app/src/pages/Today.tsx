import { dayKey, DAY, knownNoteCount, reviewsByDay, streak, summarizeLogs, forecast, withArticle, type Note } from '@anker/core';
import { BookOpenTextIcon, CaretRightIcon, CheckCircleIcon, CheckIcon, type Icon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Heatmap } from '../components/charts';
import { GenderTag, SpeakButton } from '../components/CardView';
import { DeckCover } from '../components/DeckCover';
import { Brain, Calculator, Clock, Flame, Headphones, Layers, Library, Plus, Send, Sparkles, Target, Zap } from '../components/icons';
import { StreakBadge } from '../components/Layout';
import { Wordmark } from '../components/Logo';
import { OttoBadge } from '../components/Otto';
import { Button, cx, Modal, Panel } from '../components/ui';
import { db } from '../lib/db';
import { anzahl, dauer } from '../lib/format';
import { useDeckCounts, useDecks, useHub, useLiveQuery, usePrefs, useTodayLogs } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import { renderField } from '../lib/sanitize';

function greeting(h: number) {
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Guten Tag';
  if (h < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

const TINT = {
  koralle: { bg: 'var(--koralle-soft)', fg: 'var(--koralle-ink)' },
  hafen: { bg: 'var(--hafen-soft)', fg: 'var(--hafen)' },
  sonne: { bg: 'var(--sonne)', fg: 'var(--on-sonne)' },
  krake: { bg: 'var(--krake-soft)', fg: 'var(--krake-deep)' },
  tanne: { bg: 'var(--tanne)', fg: 'var(--tanne-on)' },
  neutral: { bg: 'var(--paper-sunk)', fg: 'var(--ink)' },
} as const;

export const DRILLS = [
  { id: 'artikel', title: 'Artikel-Blitz', desc: 'der, die oder das? 60 Sekunden.', icon: Zap, tint: TINT.koralle },
  { id: 'zahlen', title: 'Zahlen-Diktat', desc: 'Zahlen hören und tippen.', icon: Calculator, tint: TINT.hafen },
  { id: 'uhrzeit', title: 'Wie spät ist es?', desc: '„Viertel vor drei“ und Co.', icon: Clock, tint: TINT.sonne },
  { id: 'kasus', title: 'Kasus-Trainer', desc: 'Präposition → der richtige Artikel.', icon: Target, tint: TINT.krake },
  { id: 'verben', title: 'Stammformen', desc: 'fahren · fuhr · ist gefahren', icon: Brain, tint: TINT.tanne },
  { id: 'diktat', title: 'Diktat', desc: 'Hör zu und schreib deine Wörter.', icon: Headphones, tint: TINT.neutral },
] as const;

/** Word of the day: a sonne card, text in on-sonne; the gender shows as a chip. */
function WordOfTheDay({ note }: { note: Note }) {
  const f = note.fields;
  return (
    <div className="rounded-md bg-sonne p-4 text-on-sonne">
      <div className="flex items-center justify-between">
        <span className="t-overline">Wort des Tages</span>
        <SpeakButton text={withArticle(f.german ?? '', f.gender)} className="-my-2 -mr-1 bg-transparent text-on-sonne hover:bg-[#3a2a0014] hover:text-on-sonne" />
      </div>
      <Link to={`/edit/${note.id}`} className="block">
        <div className="mt-1 flex items-center gap-2">
          <GenderTag gender={f.gender} long />
        </div>
        <div className="t-title mt-2" lang="de">
          {f.german}
        </div>
        <div className="t-body mt-0.5" dangerouslySetInnerHTML={{ __html: renderField(f.english) }} />
        {f.example && (
          <div className="mt-4 rounded-md bg-[#fffaf0] px-3.5 py-2.5 text-[#141414]">
            <div className="t-body" lang="de" dangerouslySetInnerHTML={{ __html: renderField(f.example) }} />
            {f.exampleTranslation && <div className="t-caption text-[#6f685c]" dangerouslySetInnerHTML={{ __html: renderField(f.exampleTranslation) }} />}
          </div>
        )}
      </Link>
    </div>
  );
}

interface Mission {
  text: string;
  detail?: string;
  done: boolean;
  icon: Icon | typeof Flame;
  tint: { bg: string; fg: string };
}

function MissionSheet({ open, onClose, missions }: { open: boolean; onClose: () => void; missions: Mission[] }) {
  const done = missions.filter((m) => m.done).length;
  const all = done === missions.length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="t-title">Deine Tagesmission</span>}
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => {
            onClose();
            if (!all) navigate('/study');
          }}
        >
          Weiter
        </Button>
      }
    >
      <div>
        {missions.map((m, i) => (
          <div key={i} className={cx('flex items-center gap-3 py-3', i > 0 && 'border-t border-line')}>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md" style={{ background: m.tint.bg, color: m.tint.fg }}>
              <m.icon className="size-6" weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-label block">{m.text}</span>
              {m.detail && <span className="t-caption block text-ink-muted">{m.detail}</span>}
            </span>
            {m.done ? (
              <span className="anim-pop flex size-6 items-center justify-center rounded-full bg-wiese text-on-wiese" aria-label="Geschafft">
                <CheckIcon weight="bold" className="size-3.5" />
              </span>
            ) : (
              <span className="size-[22px] rounded-full border-2 border-line" aria-label="Offen" />
            )}
          </div>
        ))}
        <div className={cx('t-overline mt-2 rounded-sm px-3 py-1.5 text-center', all ? 'bg-wiese text-on-wiese' : 'bg-paper-sunk text-ink-muted')}>
          {all ? `${missions.length} Missionen geschafft` : `${done} von ${missions.length} geschafft`}
        </div>
      </div>
    </Modal>
  );
}

export function Today({ due }: { due: number }) {
  const prefs = usePrefs();
  const decks = useDecks();
  const counts = useDeckCounts();
  const todayLogs = useTodayLogs();
  const hub = useHub();
  const [ask, setAsk] = useState('');
  const [missionOpen, setMissionOpen] = useState(false);
  const now = Date.now();
  const since = now - 371 * DAY;
  const yearLogs = useLiveQuery(() => db.revlog.where('review').above(since).toArray(), [Math.floor(since / DAY)]);
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const wordNotes = useLiveQuery(() => db.notes.where('type').equals('word').toArray(), []);

  const today = summarizeLogs(todayLogs ?? []);
  const days = useMemo(() => reviewsByDay(yearLogs ?? [], prefs.rolloverHour), [yearLogs, prefs.rolloverHour]);
  const st = streak(days, now, prefs.rolloverHour);
  const known = cards ? knownNoteCount(cards) : 0;
  const tomorrow = cards ? forecast(cards, now, prefs.rolloverHour, 2)[1] ?? 0 : 0;

  const totals = useMemo(() => {
    const t = { new: 0, learn: 0, review: 0 };
    if (!decks || !counts) return t;
    for (const d of decks) {
      if (d.parentId && decks.some((p) => p.id === d.parentId)) continue;
      const c = counts.get(d.id);
      if (c) {
        t.new += c.new;
        t.learn += c.learn;
        t.review += c.review;
      }
    }
    return t;
  }, [decks, counts]);

  const wotd = useMemo(() => {
    if (!wordNotes?.length) return null;
    const withEx = wordNotes.filter((n) => n.fields.example);
    const pool = withEx.length ? withEx : wordNotes;
    const key = dayKey(now, prefs.rolloverHour);
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool.sort((a, b) => a.id.localeCompare(b.id))[h % pool.length]!;
  }, [wordNotes, prefs.rolloverHour]);

  // "Decks für dich": leaf decks with the most due cards first.
  const forYou = useMemo(() => {
    if (!decks || !counts) return [];
    const hasChildren = new Set(decks.map((d) => d.parentId).filter(Boolean));
    return decks
      .filter((d) => !hasChildren.has(d.id))
      .map((d) => ({ d, c: counts.get(d.id)! }))
      .filter((x) => x.c)
      .sort((a, b) => b.c.review + b.c.learn + b.c.new - (a.c.review + a.c.learn + a.c.new) || a.d.name.localeCompare(b.d.name))
      .slice(0, 8);
  }, [decks, counts]);

  const goal = Math.max(1, prefs.dailyGoal);
  const newTarget = Math.min(5, today.learned + totals.new);
  const missions: Mission[] = [
    { text: 'Serie fortsetzen', detail: st.current ? `${anzahl(st.current, 'Tag', 'Tage')} in Folge` : undefined, done: today.reviews > 0, icon: Flame, tint: TINT.koralle },
    { text: `${goal} Karten wiederholen`, detail: `${Math.min(today.reviews, goal)} von ${goal}`, done: today.reviews >= goal, icon: Layers, tint: TINT.hafen },
    {
      text: newTarget ? `${newTarget} neue Wörter lernen` : 'Neue Wörter lernen',
      detail: newTarget ? `${Math.min(today.learned, newTarget)} von ${newTarget}` : 'Heute keine neuen Karten übrig',
      done: newTarget === 0 || today.learned >= newTarget,
      icon: BookOpenTextIcon,
      tint: TINT.krake,
    },
  ];

  const hour = new Date().getHours();
  const dateStr = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const allDone = due === 0 && (cards?.length ?? 0) > 0;
  const empty = decks !== undefined && decks.length === 0;
  const minutes = Math.round(today.timeMs / 60_000);

  return (
    <div className="mx-auto max-w-3xl px-5 pt-5 pb-10 md:px-8 md:pt-10">
      {!empty && (
        <div className="mb-6 flex items-center justify-between md:hidden">
          <Wordmark size={32} />
          <StreakBadge days={st.current} />
        </div>
      )}

      <p className="t-overline text-ink-muted">{dateStr}</p>
      <h1 className="t-hero mt-1.5">
        {greeting(hour)}
        {prefs.name ? `, ${prefs.name}` : ''}.
      </h1>

      {empty ? (
        <Panel className="mt-6 flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
          <OttoBadge size={96} mood="happy" />
          <div className="min-w-0 flex-1">
            <h2 className="t-heading">Dein erstes Deck</h2>
            <p className="mt-1 text-[15px] text-ink-muted">Starte mit einem Starter-Deck, füge eigene Wörter hinzu oder importiere aus Anki.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => navigate('/welcome')} icon={<Library className="size-5" />}>
                Starter-Decks
              </Button>
              <Button size="lg" onClick={() => navigate('/add')} icon={<Plus className="size-5" />}>
                Wörter hinzufügen
              </Button>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          {/* Stat card with the mission strip */}
          <div className="mt-6 overflow-hidden rounded-md border border-line bg-paper-raised">
            <div className="grid grid-cols-4 py-3 text-center">
              {[
                { n: st.current, l: st.current === 1 ? 'Tag' : 'Tage', c: 'var(--koralle-ink)', flame: true },
                { n: known, l: 'Wörter', c: 'var(--hafen)' },
                { n: minutes, l: 'Min.', c: 'var(--wiese)' },
                { n: today.reviews, l: 'Karten', c: 'var(--ink)' },
              ].map((s, i) => (
                <div key={s.l} className={cx('px-1', i > 0 && 'border-l border-line')}>
                  <div className="t-stat flex items-center justify-center gap-0.5" style={{ color: s.c }}>
                    {s.flame && <Flame weight="fill" className="size-[18px]" />}
                    {s.n.toLocaleString('de-DE')}
                  </div>
                  <div className="t-caption text-ink-muted">{s.l}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setMissionOpen(true)} className="t-overline flex w-full items-center justify-between bg-hafen px-3 py-2 text-on-hafen">
              <span>Deine Tagesmission · {missions.filter((m) => m.done).length}/3</span>
              <CaretRightIcon weight="bold" className="size-4" />
            </button>
          </div>

          {allDone ? (
            <div className="mt-4 flex items-center gap-3 rounded-md bg-wiese-soft px-4 py-3.5">
              <CheckCircleIcon weight="fill" className="size-7 shrink-0 text-wiese" />
              <div className="min-w-0">
                <div className="t-label">Alles erledigt!</div>
                <div className="t-caption text-ink-muted">
                  {today.reviews ? `${anzahl(today.reviews, 'Karte', 'Karten')} in ${dauer(today.timeMs)}. ` : ''}
                  {tomorrow ? `Morgen ${tomorrow === 1 ? 'ist 1 Karte' : `sind ${tomorrow} Karten`} fällig.` : ''}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <Button variant="primary" size="lg" className="w-full" onClick={() => navigate('/study')}>
                {anzahl(due, 'Karte', 'Karten')} wiederholen
              </Button>
              <p className="t-caption mt-2 text-center text-ink-muted tabular-nums">
                <span className="font-bold text-hafen">{totals.new}</span> neu · <span className="font-bold text-koralle-ink">{totals.learn}</span> in Arbeit ·{' '}
                <span className="font-bold text-wiese">{totals.review}</span> fällig
              </p>
            </div>
          )}
        </>
      )}

      {forYou.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-heading">Decks für dich</h2>
            <Link to="/decks" className="t-label text-hafen">
              Alle
            </Link>
          </div>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {forYou.map(({ d, c }) => {
              const n = c.new + c.learn + c.review;
              return (
                <Link key={d.id} to={`/decks/${d.id}`} className="w-[104px] shrink-0 rounded-sm">
                  <DeckCover deck={d} />
                  <div className="t-caption mt-1.5 text-ink-muted">{n ? `${n} fällig` : 'Erledigt'}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {wotd && (
        <section className="mt-8">
          <WordOfTheDay note={wotd} />
        </section>
      )}

      {hub && (
        <form
          className="mt-6 flex items-center gap-2 rounded-md border border-line bg-paper-raised py-1.5 pr-1.5 pl-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ask.trim()) return;
            navigate(`/tutor?q=${encodeURIComponent(ask.trim())}`);
          }}
        >
          <Sparkles className="size-5 shrink-0 text-ink-muted" />
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Frag den Tutor – „Wann benutzt man ‚seit‘?“"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-muted"
          />
          <button type="submit" disabled={!ask.trim()} aria-label="Fragen" className="flex size-11 items-center justify-center rounded-md bg-paper-sunk text-ink disabled:opacity-40">
            <Send className="size-5" />
          </button>
        </form>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="t-heading">Übungen</h2>
          <Link to="/practice" className="t-label text-hafen">
            Alle
          </Link>
        </div>
        <Panel className="divide-y divide-line overflow-hidden">
          {DRILLS.slice(0, 4).map((d) => {
            const Icon = d.icon;
            return (
              <Link key={d.id} to={`/practice/${d.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-paper-sunk">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md" style={{ background: d.tint.bg, color: d.tint.fg }}>
                  <Icon className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t-label block">{d.title}</span>
                  <span className="t-caption block truncate text-ink-muted">{d.desc}</span>
                </span>
                <CaretRightIcon className="size-5 text-ink-muted" />
              </Link>
            );
          })}
        </Panel>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="t-heading">Dein Jahr</h2>
          <Link to="/stats" className="t-label text-hafen">
            Statistik
          </Link>
        </div>
        <Panel className="p-4">
          <Heatmap days={days} weeks={26} rolloverHour={prefs.rolloverHour} />
        </Panel>
      </section>

      {!hub && (
        <Panel className="mt-6 flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="t-label">Mit deinem Mac verbinden</div>
            <div className="t-caption text-ink-muted">Decks zwischen Geräten synchronisieren und den KI-Tutor nutzen (Claude & Codex).</div>
          </div>
          <Button onClick={() => navigate('/connect')}>Verbinden</Button>
        </Panel>
      )}
      <MissionSheet open={missionOpen} onClose={() => setMissionOpen(false)} missions={missions} />
    </div>
  );
}
