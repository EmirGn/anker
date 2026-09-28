import {
  answerButtons,
  cardBreakdown,
  dayKey,
  addDaysKey,
  forecast,
  hourlyBreakdown,
  knownNoteCount,
  noteTitle,
  retention,
  reviewsByDay,
  streak,
  DAY,
} from '@anker/core';
import { Flame, Sparkles } from '../components/icons';
import { useMemo, useState } from 'react';
import { Bars, Heatmap, StackedBar } from '../components/charts';
import { GenderWord } from '../components/CardView';
import { Button, PageHeader, Panel, Section, Segmented, Spinner, cx } from '../components/ui';
import { db } from '../lib/db';
import { dauer } from '../lib/format';
import { useHub, useLiveQuery, usePrefs } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import { LOCALE, tr } from '../lib/i18n';

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
      labels.push(i === 0 ? tr('Heute') : i % Math.ceil(n / 6) === 0 ? `${Number(k.slice(8))}.${Number(k.slice(5, 7))}.` : null);
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
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-16 md:px-8 md:pt-10">
      <PageHeader
        title={tr('Statistik')}
        subtitle={tr('So geht es deinem deutschen Gedächtnis.')}
        actions={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '30', label: tr('30 Tage') },
              { value: '90', label: tr('90 Tage') },
              { value: '365', label: tr('Jahr') },
            ]}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-md border border-line bg-paper-raised text-center md:grid-cols-4">
        {[
          {
            v: (
              <span className="flex items-center justify-center gap-0.5 text-koralle-ink">
                <Flame weight="fill" className="size-[18px]" />
                {s.streak.current}
              </span>
            ),
            l: tr('Tage in Folge'),
            d: tr('Rekord: {0}', s.streak.longest),
          },
          { v: s.retention.rate == null ? '–' : `${Math.round(s.retention.rate * 100)} %`, l: tr('Behalten'), d: tr('{0} gefestigte Wiederholungen', s.retention.reviews) },
          { v: s.totalReviews.toLocaleString(LOCALE), l: tr('Wiederholungen'), d: tr('{0} · {1} aktive Tage', dauer(s.totalTime), s.activeDays) },
          { v: <span className="text-hafen">{s.known.toLocaleString(LOCALE)}</span>, l: tr('Wörter gelernt'), d: tr('{0} gefestigte Karten', s.breakdown.mature) },
        ].map((x, i) => (
          <div key={x.l} className={cx('px-2 py-3', i % 2 === 1 && 'border-l border-line', i > 1 && 'border-t border-line md:border-t-0', i === 2 && 'md:border-l')}>
            <div className="t-stat">{x.v}</div>
            <div className="t-caption text-ink">{x.l}</div>
            <div className="t-caption text-ink-muted">{x.d}</div>
          </div>
        ))}
      </div>

      <Section title={tr('Kalender')}>
        <Panel className="p-4 md:p-5">
          <Heatmap days={s.days} weeks={53} rolloverHour={prefs.rolloverHour} />
        </Panel>
      </Section>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Section title={tr('Wiederholungen pro Tag')}>
          <Panel className="p-4">
            <Bars values={s.perDay} labels={s.labels} format={(v) => tr('{0} Wiederholungen', v)} />
          </Panel>
        </Section>
        <Section title={tr('Fällig in den nächsten 30 Tagen')}>
          <Panel className="p-4">
            <Bars values={s.forecast} labels={s.forecast.map((_, i) => (i === 0 ? tr('Heute') : i % 5 === 0 ? `+${i}` : null))} color="var(--wiese)" format={(v) => tr('{0} fällig', v)} />
          </Panel>
        </Section>
      </div>

      <Section title={tr('Deine Karten')}>
        <Panel className="p-4">
          <StackedBar
            parts={[
              { label: tr('Neu'), value: s.breakdown.new, color: 'var(--hafen)' },
              { label: tr('In Arbeit'), value: s.breakdown.learning, color: 'var(--koralle-ink)' },
              { label: tr('Jung'), value: s.breakdown.young, color: 'color-mix(in srgb, var(--wiese) 55%, var(--line))' },
              { label: tr('Gefestigt (21+ Tage)'), value: s.breakdown.mature, color: 'var(--wiese)' },
              { label: tr('Ausgesetzt'), value: s.breakdown.suspended, color: 'var(--ink-muted)' },
            ]}
          />
        </Panel>
      </Section>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Section title={tr('Antworten')}>
          <Panel className="space-y-3 p-4">
            {(
              [
                ['Nochmal', 'var(--koralle-ink)'],
                ['Schwer', 'var(--sonne-ink)'],
                ['Gut', 'var(--wiese)'],
                ['Leicht', 'var(--hafen)'],
              ] as const
            ).map(([label, color], i) => (
              <div key={label} className="flex items-center gap-3 text-[13px]">
                <span className="w-16 font-semibold">{tr(label)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                  <div className="h-full rounded-full" style={{ width: `${(s.buttons[i]! / totalButtons) * 100}%`, background: color }} />
                </div>
                <span className="w-20 text-right text-ink-muted tabular-nums">
                  {s.buttons[i]} · {Math.round((s.buttons[i]! / totalButtons) * 100)} %
                </span>
              </div>
            ))}
          </Panel>
        </Section>
        <Section title={tr('Tageszeit')}>
          <Panel className="p-4">
            <Bars values={s.hours.map((h) => h.reviews)} labels={s.hours.map((_, i) => (i % 6 === 0 ? tr('{0} Uhr', i) : null))} height={90} format={(v) => tr('{0} Wiederholungen', v)} />
            <p className="t-caption text-ink-muted">
              {s.bestHour
                ? tr('Am besten merkst du dir Wörter gegen {0} Uhr ({1} % richtig).', s.bestHour.i, Math.round(s.bestHour.rate * 100))
                : tr('Wiederhol noch etwas mehr, dann zeigt sich deine beste Tageszeit.')}
            </p>
          </Panel>
        </Section>
      </div>

      <Section
        title={tr('Schwierigste Wörter')}
        action={
          hub &&
          s.hardest.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Sparkles className="size-4" />}
              onClick={() => navigate(`/otto?go=1&q=${encodeURIComponent(tr('Sieh dir meine schwierigsten Karten an (get_study_stats) und ergänze bei den 10 schwersten eine kurze, anschauliche Eselsbrücke im Notizfeld. Behalte vorhandene Notizen.'))}`)}
            >{tr('Eselsbrücken von der KI')}</Button>
          )
        }
      >
        {s.hardest.length === 0 ? (
          <Panel className="p-4 text-[15px] text-ink-muted">{tr('Noch keine Sorgenkinder.')}</Panel>
        ) : (
          <Panel className="divide-y divide-line">
            {s.hardest.map(({ note, lapses }) => (
              <Link key={note.id} to={`/edit/${note.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-paper-sunk">
                <span className="t-label min-w-0 flex-1 truncate">
                  {note.type === 'word' ? <GenderWord word={note.fields.german ?? ''} gender={note.fields.gender} /> : noteTitle(note)}
                </span>
                <span className="t-caption truncate text-ink-muted">{note.fields.english ?? note.fields.back ?? ''}</span>
                <span className="w-20 shrink-0 text-right text-[13px] font-bold text-koralle-ink">{lapses}{' '}{tr('Fehler')}</span>
              </Link>
            ))}
          </Panel>
        )}
      </Section>
    </div>
  );
}
