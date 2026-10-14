// The study plan on Today: countdown, today's tasks to tick off, a link to the
// full plan. Task rows are shared with the plan page.
import { daysBetween, dayProgress, isTaskDone, planDay, planPhase, planProgress, type PlanDay, type PlanTask, type PlanTaskKind, type StudyPlan } from '@anker/core';
import { CaretRightIcon, CheckIcon } from '@phosphor-icons/react';
import { renderMarkdown } from '../lib/markdown';
import { LOCALE, tr } from '../lib/i18n';
import { Link } from '../lib/router';
import { setPlanTaskDone } from '../lib/repo';
import { BookOpen, Headphones, Layers, Library, Mic, Pencil, Tag, Target, Trophy, type Icon } from './icons';
import { cx, Panel } from './ui';

const KIND: Record<PlanTaskKind, { icon: Icon; bg: string; fg: string }> = {
  cards: { icon: Layers, bg: 'var(--hafen-soft)', fg: 'var(--hafen)' },
  grammar: { icon: BookOpen, bg: 'var(--krake-soft)', fg: 'var(--krake-deep)' },
  listening: { icon: Headphones, bg: 'var(--sonne)', fg: 'var(--on-sonne)' },
  reading: { icon: Library, bg: 'var(--tanne)', fg: 'var(--tanne-on)' },
  writing: { icon: Pencil, bg: 'var(--koralle-soft)', fg: 'var(--koralle-ink)' },
  speaking: { icon: Mic, bg: 'var(--hafen-soft)', fg: 'var(--hafen)' },
  vocab: { icon: Tag, bg: 'var(--paper-sunk)', fg: 'var(--ink)' },
  test: { icon: Trophy, bg: 'var(--sonne)', fg: 'var(--on-sonne)' },
  other: { icon: Target, bg: 'var(--paper-sunk)', fg: 'var(--ink)' },
};

export function planDate(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, opts);
}

export function countdownLabel(plan: StudyPlan, today: string): string | null {
  if (!plan.goalDate) return null;
  const left = daysBetween(today, plan.goalDate);
  if (left > 1) return tr('Noch {0} Tage', left);
  if (left === 1) return tr('Noch 1 Tag');
  if (left === 0) return tr('Heute ist Prüfung');
  return tr('Ziel erreicht?');
}

export function dayTypeLabel(day: PlanDay): string | null {
  if (day.type === 'test') return tr('Testtag');
  if (day.type === 'light') return tr('Leichter Tag');
  if (day.type === 'exam') return tr('Prüfung');
  return null;
}

export function PlanTaskRow({
  plan,
  day,
  task,
  auto,
  first,
}: {
  plan: StudyPlan;
  day: PlanDay;
  task: PlanTask;
  auto: (date: string) => boolean;
  first?: boolean;
}) {
  const done = isTaskDone(plan, day, task, auto);
  const autoDone = done && !plan.done[`${day.date}/${task.id}`];
  const k = KIND[task.kind] ?? KIND.other;
  return (
    <div className={cx('flex items-start gap-3 py-3', !first && 'border-t border-line')}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md" style={{ background: k.bg, color: k.fg }}>
        <k.icon className="size-5" weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('t-label block', done && 'text-ink-muted line-through decoration-line')}>{task.title}</span>
        {task.detail && <span className="md t-caption mt-0.5 block text-ink-muted" dangerouslySetInnerHTML={{ __html: renderMarkdown(task.detail) }} />}
        {task.kind === 'cards' && !done && <span className="t-caption mt-0.5 block text-ink-muted">{tr('Hakt sich selbst ab, sobald deine Wiederholungen fertig sind.')}</span>}
        {task.link && !done && (
          <Link to={task.link} className="t-label mt-1 inline-flex items-center gap-0.5 text-hafen">
            {tr('Öffnen')}
            <CaretRightIcon weight="bold" className="size-3.5" />
          </Link>
        )}
      </span>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={task.title}
        disabled={autoDone}
        onClick={() => void setPlanTaskDone(plan.id, day.date, task.id, !done)}
        className="-m-2.5 flex size-11 shrink-0 items-center justify-center rounded-full"
      >
        {done ? (
          <span className="anim-pop flex size-6 items-center justify-center rounded-full bg-wiese text-on-wiese">
            <CheckIcon weight="bold" className="size-3.5" />
          </span>
        ) : (
          <span className="size-[22px] rounded-full border-2 border-ink-muted/40" />
        )}
      </button>
    </div>
  );
}

/** Today's card: shown under the stat card while a plan is active, and atop the plan page (`inPlan`). */
export function PlanCard({ plan, today, auto, inPlan }: { plan: StudyPlan; today: string; auto: (date: string) => boolean; inPlan?: boolean }) {
  const day = planDay(plan, today);
  const upcoming = day ? undefined : plan.days.find((d) => d.date > today);
  if (!day && !upcoming) return null;
  const shown = day ?? upcoming!;
  const phase = planPhase(plan, shown.date);
  const prog = planProgress(plan, auto);
  const dp = dayProgress(plan, shown, auto);
  const countdown = countdownLabel(plan, today);
  const studyDays = plan.days.filter((d) => d.type !== 'exam');
  const index = studyDays.findIndex((d) => d.date === shown.date);
  const typeLabel = dayTypeLabel(shown);

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="t-overline text-ink-muted">
            {plan.goal ?? tr('Lernplan')}
            {phase ? ` · ${phase.name}` : ''}
          </div>
          <h2 className="t-heading mt-1">{shown.focus ?? (day ? tr('Heute') : planDate(shown.date))}</h2>
          {!day && <p className="t-caption mt-0.5 text-ink-muted">{tr('Der Plan beginnt am {0}.', planDate(shown.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>}
        </div>
        {countdown && !inPlan && <span className="shrink-0 rounded-full bg-sonne px-2.5 py-0.5 text-[13px] leading-[18px] font-bold whitespace-nowrap text-on-sonne tabular-nums">{countdown}</span>}
      </div>
      {typeLabel && (
        <div className="px-4 pt-2">
          <span className="t-overline rounded-full bg-hafen px-2 py-0.5 text-on-hafen">{typeLabel}</span>
        </div>
      )}
      <div className="px-4">
        {shown.tasks.map((t, i) => (
          <PlanTaskRow key={t.id} plan={plan} day={shown} task={t} auto={auto} first={i === 0} />
        ))}
      </div>
      {inPlan ? (
        <div className="t-overline border-t border-line px-4 py-2.5 text-ink-muted tabular-nums">
          {index >= 0 ? `${tr('Tag {0} von {1}', index + 1, studyDays.length)} · ` : ''}
          {dp.done}/{dp.total}
        </div>
      ) : (
        <Link to="/plan" className="t-overline flex w-full items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-ink-muted">
          <span className="tabular-nums">
            {index >= 0 ? `${tr('Tag {0} von {1}', index + 1, studyDays.length)} · ` : ''}
            {dp.done}/{dp.total} · {tr('{0} von {1} Tagen geschafft', prog.complete, prog.total)}
          </span>
          <span className="flex items-center gap-1 text-hafen">
            {tr('Ganzer Plan')}
            <CaretRightIcon weight="bold" className="size-4" />
          </span>
        </Link>
      )}
    </Panel>
  );
}
