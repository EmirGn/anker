// Study plans: a dated list of daily tasks towards a goal (usually an exam).
// The plan travels as one synced record; ticked tasks live in `done`.
import { newId } from './ids';
import type { PlanDay, PlanPhase, PlanSection, PlanTask, PlanTaskKind, StudyPlan } from './types';

export const PLAN_TASK_KINDS: readonly PlanTaskKind[] = ['cards', 'grammar', 'listening', 'reading', 'writing', 'speaking', 'vocab', 'test', 'other'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function planTaskKey(date: string, taskId: string): string {
  return `${date}/${taskId}`;
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** The plan shown on Today: the most recently changed active one. */
export function activePlan(plans: StudyPlan[] | undefined): StudyPlan | undefined {
  return (plans ?? []).filter((p) => p.active).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function planDay(plan: StudyPlan, date: string): PlanDay | undefined {
  return plan.days.find((d) => d.date === date);
}

export function planPhase(plan: StudyPlan, date: string): PlanPhase | undefined {
  return plan.phases.find((p) => date >= p.from && date <= p.to);
}

/**
 * Is a task done? Ticked by hand, or — for 'cards' tasks — when `autoCards`
 * says that day's reviews are finished.
 */
export function isTaskDone(plan: StudyPlan, day: PlanDay, task: PlanTask, autoCards?: (date: string) => boolean): boolean {
  if (plan.done[planTaskKey(day.date, task.id)]) return true;
  return task.kind === 'cards' && !!autoCards?.(day.date);
}

export function dayProgress(plan: StudyPlan, day: PlanDay, autoCards?: (date: string) => boolean) {
  const done = day.tasks.filter((t) => isTaskDone(plan, day, t, autoCards)).length;
  return { done, total: day.tasks.length, complete: day.tasks.length > 0 && done === day.tasks.length };
}

/** Completed study days (the exam day itself doesn't count). */
export function planProgress(plan: StudyPlan, autoCards?: (date: string) => boolean) {
  const study = plan.days.filter((d) => d.type !== 'exam');
  const complete = study.filter((d) => dayProgress(plan, d, autoCards).complete).length;
  return { complete, total: study.length };
}

export interface PlanInput {
  title: string;
  goal?: string;
  goalDate?: string;
  facts?: { value: string; label: string }[];
  phases?: PlanPhase[];
  days: { date: string; focus?: string; type?: PlanDay['type']; tasks: (Omit<PlanTask, 'id' | 'kind'> & { id?: string; kind?: PlanTaskKind })[] }[];
  sections?: PlanSection[];
}

/**
 * Check and tidy a plan written by a person or an agent. Task ids are kept or
 * generated; ticks on tasks that still exist carry over from `existing`.
 */
export function buildPlan(input: PlanInput, existing?: StudyPlan, now = Date.now()): StudyPlan {
  const title = input.title?.trim();
  if (!title) throw new Error('title is required');
  if (input.goalDate && !DATE_RE.test(input.goalDate)) throw new Error(`goalDate must be YYYY-MM-DD, got "${input.goalDate}"`);
  const seenDates = new Set<string>();
  const days: PlanDay[] = [...(input.days ?? [])]
    .map((d) => {
      if (!DATE_RE.test(d.date)) throw new Error(`day date must be YYYY-MM-DD, got "${d.date}"`);
      if (seenDates.has(d.date)) throw new Error(`day ${d.date} appears twice`);
      seenDates.add(d.date);
      const ids = new Set<string>();
      const tasks = (d.tasks ?? []).map((t, i) => {
        if (!t.title?.trim()) throw new Error(`task ${i + 1} on ${d.date} has no title`);
        let id = (t.id ?? '').trim() || `t${i + 1}`;
        while (ids.has(id)) id = `${id}-${newId(4)}`;
        ids.add(id);
        const kind = t.kind && PLAN_TASK_KINDS.includes(t.kind) ? t.kind : 'other';
        const task: PlanTask = { id, kind, title: t.title.trim() };
        if (t.detail?.trim()) task.detail = t.detail.trim();
        if (t.link?.trim().startsWith('/')) task.link = t.link.trim();
        return task;
      });
      const day: PlanDay = { date: d.date, tasks };
      if (d.focus?.trim()) day.focus = d.focus.trim();
      if (d.type && d.type !== 'study') day.type = d.type;
      return day;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) throw new Error('a plan needs at least one day');

  const phases = (input.phases ?? []).map((p) => {
    if (!DATE_RE.test(p.from) || !DATE_RE.test(p.to)) throw new Error(`phase "${p.name}" needs from/to as YYYY-MM-DD`);
    return { name: p.name.trim(), ...(p.summary?.trim() ? { summary: p.summary.trim() } : {}), from: p.from, to: p.to };
  });

  const done: Record<string, number> = {};
  if (existing) {
    const keys = new Set(days.flatMap((d) => d.tasks.map((t) => planTaskKey(d.date, t.id))));
    for (const [k, v] of Object.entries(existing.done)) if (keys.has(k)) done[k] = v;
  }

  return {
    id: existing?.id ?? newId(),
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    title,
    ...(input.goal?.trim() ? { goal: input.goal.trim() } : {}),
    ...(input.goalDate ? { goalDate: input.goalDate } : {}),
    ...(input.facts?.length ? { facts: input.facts.filter((f) => f.value?.trim() && f.label?.trim()) } : {}),
    phases,
    days,
    ...(input.sections?.length ? { sections: input.sections.filter((s) => s.title?.trim() && s.body?.trim()) } : {}),
    done,
    active: true,
  };
}

/** Short plain-text view of a plan around `today`, for Otto and MCP clients. */
export function describePlan(plan: StudyPlan, today: string, autoCards?: (date: string) => boolean): string {
  const lines: string[] = [];
  const left = plan.goalDate ? daysBetween(today, plan.goalDate) : null;
  lines.push(`Plan: ${plan.title}${plan.goal ? ` (goal: ${plan.goal}` + (plan.goalDate ? ` on ${plan.goalDate}` : '') + ')' : ''}.`);
  if (left !== null) lines.push(left > 0 ? `${left} days left until ${plan.goalDate}.` : left === 0 ? 'The exam is today.' : 'The goal date has passed.');
  const prog = planProgress(plan, autoCards);
  lines.push(`Days completed: ${prog.complete} of ${prog.total}.`);
  const phase = planPhase(plan, today);
  if (phase) lines.push(`Current phase: ${phase.name}${phase.summary ? ` — ${phase.summary}` : ''}.`);
  const fmt = (d: PlanDay) =>
    `${d.date}${d.type && d.type !== 'study' ? ` [${d.type}]` : ''}${d.focus ? ` ${d.focus}` : ''}\n` +
    d.tasks.map((t) => `  ${isTaskDone(plan, d, t, autoCards) ? '[x]' : '[ ]'} ${t.kind}: ${t.title}${t.detail ? ` — ${t.detail}` : ''}`).join('\n');
  const past = plan.days.filter((d) => d.date < today);
  const missed = past.filter((d) => !dayProgress(plan, d, autoCards).complete).slice(-3);
  if (missed.length) lines.push(`Recent unfinished days:\n${missed.map(fmt).join('\n')}`);
  const cur = planDay(plan, today);
  lines.push(cur ? `Today:\n${fmt(cur)}` : 'No tasks planned for today.');
  const next = plan.days.find((d) => d.date > today);
  if (next) lines.push(`Next:\n${fmt(next)}`);
  return lines.join('\n');
}

/**
 * The rule that ticks 'cards' tasks by itself: that day's reviews reached the
 * daily goal, or (today) every due card is done.
 */
export function cardsAutoDone(days: Map<string, { count: number }>, dailyGoal: number, today: string, nothingDueToday: boolean) {
  return (date: string) => {
    const n = days.get(date)?.count ?? 0;
    return n >= Math.max(1, dailyGoal) || (date === today && nothingDueToday && n > 0);
  };
}
