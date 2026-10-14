// The whole study plan: countdown, headline facts, today, the notes (format,
// routine, materials) and every day grouped by phase. Tap a day to tick its tasks.
import { dayProgress, planProgress, type PlanDay, type StudyPlan } from '@anker/core';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { countdownLabel, dayTypeLabel, PlanCard, planDate, PlanTaskRow } from '../components/PlanCard';
import { Button, cx, Empty, Modal, PageHeader, Panel } from '../components/ui';
import { usePlan, usePlanClock } from '../lib/hooks';
import { renderMarkdown } from '../lib/markdown';
import { archivePlan } from '../lib/repo';
import { navigate } from '../lib/router';
import { tr } from '../lib/i18n';

function DayRow({ plan, day, today, auto, open, onToggle }: { plan: StudyPlan; day: PlanDay; today: string; auto: (d: string) => boolean; open: boolean; onToggle: () => void }) {
  const p = dayProgress(plan, day, auto);
  const [y, m, d] = day.date.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const isToday = day.date === today;
  const past = day.date < today;
  const typeLabel = dayTypeLabel(day);
  const exam = day.type === 'exam';
  return (
    <div
      className={cx(
        'rounded-md border',
        exam ? 'border-transparent bg-sonne text-on-sonne' : day.type === 'test' ? 'border-transparent bg-hafen-soft' : 'border-line bg-paper-raised',
        isToday && 'ring-2 ring-hafen',
        past && !p.complete && 'opacity-75',
      )}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-3 text-left">
        <span className="flex w-12 shrink-0 flex-col">
          <span className="t-stat tabular-nums">{date.getDate()}</span>
          <span className={cx('t-caption', exam ? 'text-on-sonne' : 'text-ink-muted')}>{planDate(day.date, { weekday: 'short' })}</span>
        </span>
        <span className="min-w-0 flex-1">
          {typeLabel && !exam && <span className="t-overline mr-1.5 rounded-full bg-hafen px-2 py-0.5 text-on-hafen">{typeLabel}</span>}
          <span className="t-label">{day.focus ?? day.tasks[0]?.title ?? ''}</span>
          {!open && (
            <span className={cx('t-caption mt-0.5 block', exam ? 'text-on-sonne' : 'text-ink-muted')}>
              {day.tasks.filter((t) => t.kind !== 'cards').map((t) => t.title).join(' · ')}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-0.5">
          {p.complete ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-wiese text-on-wiese" aria-label={tr('Erledigt')}>
              <CheckIcon weight="bold" className="size-3.5" />
            </span>
          ) : (
            <span className={cx('t-caption tabular-nums', exam ? 'text-on-sonne' : 'text-ink-muted')}>
              {p.done}/{p.total}
            </span>
          )}
          <CaretDownIcon weight="bold" className={cx('size-4 transition-transform', exam ? 'text-on-sonne' : 'text-ink-muted', open && 'rotate-180')} />
        </span>
      </button>
      {open && (
        <div className={cx('mx-3 mb-1 rounded-md px-3', exam ? 'bg-paper-raised text-ink' : 'bg-paper-raised')}>
          {day.tasks.map((t, i) => (
            <PlanTaskRow key={t.id} plan={plan} day={day} task={t} auto={auto} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlanPage({ due }: { due: number }) {
  const plan = usePlan();
  const { today, auto } = usePlanClock(plan, due);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (plan === undefined) return null;
  if (plan === null) {
    return (
      <div className="mx-auto max-w-2xl px-5 pt-8 pb-10">
        <PageHeader title={tr('Lernplan')} />
        <Empty title={tr('Noch kein Lernplan')} action={<Button variant="primary" onClick={() => navigate('/otto')}>{tr('Plan mit Otto machen')}</Button>}>
          {tr('Bitte Otto um einen Plan, zum Beispiel für eine Prüfung. Er erscheint dann hier und auf „Heute“.')}
        </Empty>
      </div>
    );
  }

  const prog = planProgress(plan, auto);
  const countdown = countdownLabel(plan, today);
  const unphased = plan.days.filter((d) => !plan.phases.some((p) => d.date >= p.from && d.date <= p.to));
  const groups = [
    ...plan.phases.map((p, i) => ({ key: `p${i}`, label: tr('Phase {0}', i + 1), name: p.name, summary: p.summary, days: plan.days.filter((d) => d.date >= p.from && d.date <= p.to) })),
    ...(unphased.length ? [{ key: 'rest', label: '', name: tr('Lernplan'), summary: undefined, days: unphased }] : []),
  ].filter((g) => g.days.length);

  return (
    <div className="mx-auto max-w-2xl px-5 pt-8 pb-12">
      <PageHeader
        overline={plan.goal ? `${plan.goal}${plan.goalDate ? ` · ${planDate(plan.goalDate, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}` : tr('Lernplan')}
        title={plan.title}
        subtitle={tr('{0} von {1} Tagen geschafft', prog.complete, prog.total)}
        actions={countdown ? <span className="rounded-full bg-sonne px-3 py-1 text-[13px] font-bold text-on-sonne tabular-nums">{countdown}</span> : undefined}
      />
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-paper-sunk" aria-hidden>
        <div className="h-full rounded-full bg-hafen" style={{ width: `${prog.total ? (prog.complete / prog.total) * 100 : 0}%` }} />
      </div>

      {!!plan.facts?.length && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {plan.facts.map((f, i) => (
            <div key={i} className={cx('rounded-md bg-paper-sunk p-3.5', plan.facts!.length % 2 === 1 && i === 0 && 'col-span-2 sm:col-span-1')}>
              <div className="t-stat tabular-nums">{f.value}</div>
              <div className="t-caption text-ink-muted">{f.label}</div>
            </div>
          ))}
        </div>
      )}

      <section className="mb-8">
        <PlanCard plan={plan} today={today} auto={auto} inPlan />
      </section>

      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          {g.label && <div className="t-overline text-ink-muted">{g.label} · {g.days.length === 1 ? tr('{0} Tag', 1) : tr('{0} Tage', g.days.length)}</div>}
          <h2 className="t-heading mt-1">{g.name}</h2>
          {g.summary && <p className="mt-1 text-[15px] text-ink-muted">{g.summary}</p>}
          <div className="mt-3 flex flex-col gap-2">
            {g.days.map((d) => (
              <DayRow
                key={d.date}
                plan={plan}
                day={d}
                today={today}
                auto={auto}
                open={openDay === d.date}
                onToggle={() => setOpenDay((cur) => (cur === d.date ? null : d.date))}
              />
            ))}
          </div>
        </section>
      ))}

      {plan.sections?.map((s, i) => (
        <section key={i} className="mb-6">
          <h2 className="t-heading mb-3">{s.title}</h2>
          <Panel className="p-4">
            <div className="md text-[15px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }} />
          </Panel>
        </section>
      ))}

      <div className="flex justify-center">
        <Button variant="ghost" onClick={() => setConfirmArchive(true)}>{tr('Plan archivieren')}</Button>
      </div>

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={<span className="t-title">{tr('Plan archivieren')}</span>}
        footer={
          <div className="flex w-full gap-2">
            <Button className="flex-1" onClick={() => setConfirmArchive(false)}>{tr('Abbrechen')}</Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                setConfirmArchive(false);
                void archivePlan(plan.id).then(() => navigate('/'));
              }}
            >{tr('Plan archivieren')}</Button>
          </div>
        }
      >
        <p className="text-[15px] text-ink-muted">{tr('Der Plan verschwindet von „Heute“. Otto kann jederzeit einen neuen machen.')}</p>
      </Modal>
    </div>
  );
}
