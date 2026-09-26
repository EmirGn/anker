import {
  dayKey,
  DAY,
  forecast,
  knownNoteCount,
  reviewsByDay,
  streak,
  summarizeLogs,
  formatDuration,
  withArticle,
  type Note,
} from '@anker/core';
import { ArrowRight, BookOpen, Brain, Calculator, Clock, Flame, Headphones, Library, Plus, Send, Sparkles, Target, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Heatmap } from '../components/charts';
import { GenderWord, SpeakButton } from '../components/CardView';
import { Button, Chip, cx, Panel, Ring } from '../components/ui';
import { db } from '../lib/db';
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

export const DRILLS = [
  { id: 'artikel', title: 'Artikel-Blitz', desc: 'der, die oder das? 60 seconds.', icon: Zap, color: 'var(--der)' },
  { id: 'zahlen', title: 'Zahlen-Diktat', desc: 'Hear German numbers, type them.', icon: Calculator, color: 'var(--das)' },
  { id: 'uhrzeit', title: 'Wie spät ist es?', desc: '„Viertel vor drei“ & friends.', icon: Clock, color: 'var(--hard)' },
  { id: 'kasus', title: 'Kasus-Trainer', desc: 'Prepositions → the right article.', icon: Target, color: 'var(--die)' },
  { id: 'verben', title: 'Stammformen', desc: 'fahren · fuhr · ist gefahren', icon: Brain, color: 'var(--pl)' },
  { id: 'diktat', title: 'Diktat', desc: 'Listen and write your own words.', icon: Headphones, color: 'var(--easy)' },
] as const;

function WordOfTheDay({ note }: { note: Note }) {
  const f = note.fields;
  return (
    <Panel className="relative overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">Wort des Tages</span>
        <SpeakButton text={withArticle(f.german ?? '', f.gender)} className="-my-2 -mr-2" />
      </div>
      <Link to={`/edit/${note.id}`} className="block">
        <div className="font-display text-[30px] leading-tight font-semibold">
          <GenderWord word={f.german ?? ''} gender={f.gender} />
        </div>
        <div className="mt-1 text-[15px] text-muted" dangerouslySetInnerHTML={{ __html: renderField(f.english) }} />
        {f.example && (
          <div className="mt-4 border-l-2 border-accent pl-3">
            <div className="font-display text-[15.5px] italic" dangerouslySetInnerHTML={{ __html: renderField(f.example) }} />
            {f.exampleTranslation && <div className="mt-0.5 text-[13px] text-faint" dangerouslySetInnerHTML={{ __html: renderField(f.exampleTranslation) }} />}
          </div>
        )}
      </Link>
    </Panel>
  );
}

export function Today({ due }: { due: number }) {
  const prefs = usePrefs();
  const decks = useDecks();
  const counts = useDeckCounts();
  const todayLogs = useTodayLogs();
  const hub = useHub();
  const [ask, setAsk] = useState('');
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

  const topDecks = useMemo(() => {
    if (!decks || !counts) return [];
    return decks
      .filter((d) => !d.parentId || !decks.some((p) => p.id === d.parentId))
      .map((d) => ({ d, c: counts.get(d.id)! }))
      .filter((x) => x.c)
      .sort((a, b) => b.c.review + b.c.learn + b.c.new - (a.c.review + a.c.learn + a.c.new))
      .slice(0, 5);
  }, [decks, counts]);

  const goal = Math.max(1, prefs.dailyGoal);
  const progress = today.reviews / goal;
  const hour = new Date().getHours();
  const dateStr = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const allDone = due === 0 && (cards?.length ?? 0) > 0;
  const empty = decks !== undefined && decks.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-10 md:px-8 md:pt-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-faint capitalize">{dateStr}</p>
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight md:text-[38px]">
            {greeting(hour)}
            {prefs.name ? `, ${prefs.name}` : ''}!
          </h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold shadow-card" title={`Longest streak: ${st.longest} days`}>
          <Flame className={cx('size-[18px]', st.current > 0 ? 'anim-flame text-hard' : 'text-faint')} />
          {st.current}
          <span className="font-normal text-muted">{st.current === 1 ? 'day' : 'days'}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.35fr_1fr]">
        <Panel className="relative overflow-hidden p-5 md:p-6">
          <div
            className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full opacity-60 blur-3xl"
            style={{ background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)' }}
          />
          {empty ? (
            <div className="relative">
              <h2 className="font-display text-2xl font-semibold">Let's build your first deck</h2>
              <p className="mt-2 max-w-md text-[15px] text-muted">
                Start with a curated starter deck, add your own words, import from Anki — or ask the tutor to build a deck for you.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="primary" size="lg" onClick={() => navigate('/welcome')} icon={<Library className="size-5" />}>
                  Starter decks
                </Button>
                <Button size="lg" onClick={() => navigate('/add')} icon={<Plus className="size-5" />}>
                  Add words
                </Button>
              </div>
            </div>
          ) : allDone ? (
            <div className="relative">
              <div className="text-[40px] leading-none">🎉</div>
              <h2 className="mt-3 font-display text-[26px] font-semibold">Alles erledigt!</h2>
              <p className="mt-1 text-[15px] text-muted">
                You're done for today{today.reviews ? ` — ${today.reviews} reviews in ${formatDuration(today.timeMs)}` : ''}.{' '}
                {tomorrow ? `${tomorrow} cards are due tomorrow.` : ''}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => navigate('/practice')} icon={<Zap className="size-4" />}>
                  Practice games
                </Button>
                <Button onClick={() => navigate('/add')} icon={<Plus className="size-4" />}>
                  Add new words
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-muted">Due today</div>
                <div className="font-display text-[56px] leading-none font-semibold tracking-tight tabular-nums">{due}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip color="var(--easy)">{totals.new} new</Chip>
                  <Chip color="var(--again)">{totals.learn} learning</Chip>
                  <Chip color="var(--good)">{totals.review} review</Chip>
                </div>
                <Button variant="primary" size="lg" className="mt-5" onClick={() => navigate('/study')}>
                  Start studying <ArrowRight className="size-5" />
                </Button>
              </div>
              <Ring value={progress} size={116} stroke={10}>
                <div className="text-center">
                  <div className="text-[22px] font-semibold tabular-nums">{today.reviews}</div>
                  <div className="text-[11px] text-faint">of {goal}</div>
                </div>
              </Ring>
            </div>
          )}
        </Panel>

        {wotd ? (
          <WordOfTheDay note={wotd} />
        ) : (
          <Panel className="flex flex-col justify-between p-5">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">Tipp</div>
              <p className="mt-2 font-display text-[19px] leading-snug">
                Nouns ending in <b>-ung</b>, <b>-heit</b>, <b>-keit</b> are always <span style={{ color: 'var(--die)' }}>die</span>.
              </p>
            </div>
            <Link to="/grammar/genus" className="mt-4 text-sm font-medium text-accent-strong">
              More gender rules →
            </Link>
          </Panel>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Reviewed today', value: today.reviews },
          { label: 'Time today', value: today.timeMs ? formatDuration(today.timeMs) : '—' },
          { label: 'Correct', value: today.correctRate === null ? '—' : `${Math.round(today.correctRate * 100)}%` },
          { label: 'Words known', value: known },
        ].map((s) => (
          <Panel key={s.label} className="px-4 py-3">
            <div className="text-[12px] text-faint">{s.label}</div>
            <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{s.value}</div>
          </Panel>
        ))}
      </div>

      {hub && (
        <form
          className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 pl-4 shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ask.trim()) return;
            navigate(`/tutor?q=${encodeURIComponent(ask.trim())}`);
          }}
        >
          <Sparkles className="size-5 shrink-0 text-accent" />
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask the tutor — “Make me 20 cards about cooking” or “Wann benutzt man ‘seit’?”"
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <Button type="submit" variant="primary" size="md" disabled={!ask.trim()} aria-label="Ask">
            <Send className="size-4" />
          </Button>
        </form>
      )}

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Übungen</h2>
        <Link to="/practice" className="text-sm font-medium text-accent-strong">
          All →
        </Link>
      </div>
      <div className="thin-scroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
        {DRILLS.map((d) => {
          const Icon = d.icon;
          return (
            <Link
              key={d.id}
              to={`/practice/${d.id}`}
              className="group w-[210px] shrink-0 snap-start rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:shadow-card md:w-auto"
            >
              <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${d.color} 15%, transparent)`, color: d.color }}>
                <Icon className="size-5" />
              </div>
              <div className="mt-3 font-semibold">{d.title}</div>
              <div className="mt-0.5 text-[13px] text-muted">{d.desc}</div>
            </Link>
          );
        })}
      </div>

      {topDecks.length > 0 && (
        <>
          <div className="mt-8 mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Decks</h2>
            <Link to="/decks" className="text-sm font-medium text-accent-strong">
              All →
            </Link>
          </div>
          <Panel className="divide-y divide-line">
            {topDecks.map(({ d, c }) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/decks/${d.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg">{d.emoji ?? '📚'}</span>
                  <span className="truncate font-medium">{d.name}</span>
                </Link>
                <div className="flex gap-2 text-[13px] font-semibold tabular-nums">
                  <span style={{ color: 'var(--easy)' }}>{c.new}</span>
                  <span style={{ color: 'var(--again)' }}>{c.learn}</span>
                  <span style={{ color: 'var(--good)' }}>{c.review}</span>
                </div>
                <Button size="sm" variant={c.new + c.learn + c.review ? 'primary' : 'secondary'} onClick={() => navigate(`/study/${d.id}`)}>
                  Study
                </Button>
              </div>
            ))}
          </Panel>
        </>
      )}

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Your year</h2>
        <Link to="/stats" className="text-sm font-medium text-accent-strong">
          Stats →
        </Link>
      </div>
      <Panel className="p-4">
        <Heatmap days={days} weeks={26} rolloverHour={prefs.rolloverHour} />
      </Panel>

      {!hub && (
        <Panel className="mt-6 flex flex-wrap items-center gap-4 p-5">
          <BookOpen className="size-6 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Connect to your Mac</div>
            <div className="text-sm text-muted">Sync decks between devices and unlock the AI tutor (Claude & Codex).</div>
          </div>
          <Button onClick={() => navigate('/connect')}>Connect</Button>
        </Panel>
      )}
      <div className="h-4" />
    </div>
  );
}
