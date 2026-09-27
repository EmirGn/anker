import {
  answerButtons,
  cardBreakdown,
  dayKey,
  addDaysKey,
  forecast,
  formatDuration,
  hourlyBreakdown,
  knownNoteCount,
  noteTitle,
  retention,
  reviewsByDay,
  streak,
  DAY,
} from '@anker/core';
import { Flame, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bars, Heatmap, StackedBar } from '../components/charts';
import { GenderWord } from '../components/CardView';
import { Button, PageHeader, Panel, Section, Segmented, Spinner } from '../components/ui';
import { db } from '../lib/db';
import { useHub, useLiveQuery, usePrefs } from '../lib/hooks';
import { Link, navigate } from '../lib/router';

export function Stats() {
  const prefs = usePrefs();
  const hub = useHub();
  const [range, setRange] = useState<'30' | '90' | '365'>('30');
  const data = useLiveQuery(async () => {
    const [logs, cards, notes] = await Promise.all([db.revlog.toArray(), db.cards.toArray(), db.notes.toArray()]);
    return { logs, cards, notes };
  }, []);

  const s = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const days = reviewsByDay(data.logs, prefs.rolloverHour);
    const n = Number(range);
    const today = dayKey(now, prefs.rolloverHour);
    const perDay: number[] = [];
    const labels: (string | null)[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const k = addDaysKey(today, -i);
      perDay.push(days.get(k)?.count ?? 0);
      labels.push(i === 0 ? 'Heute' : i % Math.ceil(n / 6) === 0 ? `${Number(k.slice(8))}.${Number(k.slice(5, 7))}.` : null);
    }
    const since = now - n * DAY;
    const inRange = data.logs.filter((l) => l.review >= since);
    const totalTime = inRange.reduce((sum, l) => sum + l.durationMs, 0);
    const byNote = new Map(data.notes.map((x) => [x.id, x]));
    const lapsesByNote = new Map<string, number>();
    for (const c of data.cards) lapsesByNote.set(c.noteId, Math.max(lapsesByNote.get(c.noteId) ?? 0, c.lapses));
    const hardest = [...lapsesByNote.entries()]
      .filter(([, l]) => l >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([id, lapses]) => ({ note: byNote.get(id)!, lapses }))
      .filter((x) => x.note);
    const hours = hourlyBreakdown(inRange);
    const bestHour = hours
      .map((h, i) => ({ i, rate: h.reviews >= 20 ? h.passed / h.reviews : -1 }))
      .sort((a, b) => b.rate - a.rate)[0];
    return {
      days,
      streak: streak(days, now, prefs.rolloverHour),
      perDay,
      labels,
      retention: retention(data.logs, since),
      breakdown: cardBreakdown(data.cards),
      forecast: forecast(data.cards, now, prefs.rolloverHour, 30),
      buttons: answerButtons(inRange),
      known: knownNoteCount(data.cards),
      totalReviews: inRange.length,
      totalTime,
      activeDays: perDay.filter(Boolean).length,
      hardest,
      hours,
      bestHour: bestHour && bestHour.rate >= 0 ? bestHour : null,
    };
  }, [data, range, prefs.rolloverHour]);

  if (!s) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  const totalButtons = s.buttons.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <PageHeader
        title="Statistik"
        subtitle="How your German memory is doing."
        actions={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: 'Year' },
            ]}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Panel className="px-4 py-3">
          <div className="text-[12px] text-faint">Streak</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[22px] font-semibold tabular-nums">
            <Flame className="size-5 text-hard" /> {s.streak.current}
          </div>
          <div className="text-[11.5px] text-faint">best {s.streak.longest}</div>
        </Panel>
        <Panel className="px-4 py-3">
          <div className="text-[12px] text-faint">Retention</div>
          <div className="mt-0.5 text-[22px] font-semibold tabular-nums">{s.retention.rate == null ? '—' : `${Math.round(s.retention.rate * 100)}%`}</div>
          <div className="text-[11.5px] text-faint">{s.retention.reviews} mature reviews</div>
        </Panel>
        <Panel className="px-4 py-3">
          <div className="text-[12px] text-faint">Reviews</div>
          <div className="mt-0.5 text-[22px] font-semibold tabular-nums">{s.totalReviews}</div>
          <div className="text-[11.5px] text-faint">
            {formatDuration(s.totalTime)} · {s.activeDays} active days
          </div>
        </Panel>
        <Panel className="px-4 py-3">
          <div className="text-[12px] text-faint">Words known</div>
          <div className="mt-0.5 text-[22px] font-semibold tabular-nums">{s.known}</div>
          <div className="text-[11.5px] text-faint">{s.breakdown.mature} mature cards</div>
        </Panel>
      </div>

      <Section title="Calendar">
        <Panel className="p-4 md:p-5">
          <Heatmap days={s.days} weeks={53} rolloverHour={prefs.rolloverHour} />
        </Panel>
      </Section>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Section title="Reviews per day">
          <Panel className="p-5">
            <Bars values={s.perDay} labels={s.labels} format={(v) => `${v} reviews`} />
          </Panel>
        </Section>
        <Section title="Due in the next 30 days">
          <Panel className="p-5">
            <Bars values={s.forecast} labels={s.forecast.map((_, i) => (i === 0 ? 'Heute' : i % 5 === 0 ? `+${i}` : null))} color="var(--good)" format={(v) => `${v} due`} />
          </Panel>
        </Section>
      </div>

      <Section title="Your cards">
        <Panel className="p-5">
          <StackedBar
            parts={[
              { label: 'New', value: s.breakdown.new, color: 'var(--easy)' },
              { label: 'Learning', value: s.breakdown.learning, color: 'var(--again)' },
              { label: 'Young', value: s.breakdown.young, color: 'color-mix(in srgb, var(--good) 55%, var(--surface-3))' },
              { label: 'Mature (21d+)', value: s.breakdown.mature, color: 'var(--good)' },
              { label: 'Suspended', value: s.breakdown.suspended, color: 'var(--hard)' },
            ]}
          />
        </Panel>
      </Section>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Section title="Answer buttons">
          <Panel className="space-y-2.5 p-5">
            {(['Again', 'Hard', 'Good', 'Easy'] as const).map((label, i) => (
              <div key={label} className="flex items-center gap-3 text-[13px]">
                <span className="w-12 font-medium" style={{ color: `var(--${label.toLowerCase()})` }}>
                  {label}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${(s.buttons[i]! / totalButtons) * 100}%`, background: `var(--${label.toLowerCase()})` }} />
                </div>
                <span className="w-16 text-right text-muted tabular-nums">
                  {s.buttons[i]} · {Math.round((s.buttons[i]! / totalButtons) * 100)}%
                </span>
              </div>
            ))}
          </Panel>
        </Section>
        <Section title="Time of day">
          <Panel className="p-5">
            <Bars values={s.hours.map((h) => h.reviews)} labels={s.hours.map((_, i) => (i % 6 === 0 ? `${i}h` : null))} height={90} format={(v) => `${v} reviews`} />
            <p className="text-[13px] text-muted">
              {s.bestHour
                ? `You remember best around ${s.bestHour.i}:00 (${Math.round(s.bestHour.rate * 100)}% correct).`
                : 'Review a bit more to find your best time of day.'}
            </p>
          </Panel>
        </Section>
      </div>

      <Section
        title="Hardest words"
        action={
          hub &&
          s.hardest.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Sparkles className="size-4 text-accent" />}
              onClick={() => navigate(`/tutor?q=${encodeURIComponent('Look at my most difficult cards (get_study_stats) and add a short, vivid mnemonic to the notes field of the 10 hardest ones. Keep existing notes.')}`)}
            >
              Ask AI for mnemonics
            </Button>
          )
        }
      >
        {s.hardest.length === 0 ? (
          <Panel className="p-5 text-sm text-muted">No troublemakers yet. 🎈</Panel>
        ) : (
          <Panel className="divide-y divide-line">
            {s.hardest.map(({ note, lapses }) => (
              <Link key={note.id} to={`/edit/${note.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {note.type === 'word' ? <GenderWord word={note.fields.german ?? ''} gender={note.fields.gender} /> : noteTitle(note)}
                </span>
                <span className="truncate text-[13px] text-muted">{note.fields.english ?? note.fields.back ?? ''}</span>
                <span className="w-20 shrink-0 text-right text-[12.5px] font-semibold text-again">{lapses} lapses</span>
              </Link>
            ))}
          </Panel>
        )}
      </Section>
    </div>
  );
}
