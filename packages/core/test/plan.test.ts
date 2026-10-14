import { describe, expect, it } from 'vitest';
import { activePlan, buildPlan, cardsAutoDone, dayProgress, daysBetween, describePlan, planProgress, planTaskKey } from '../src';

const input = {
  title: 'A2 plan',
  goal: 'Goethe A2',
  goalDate: '2026-11-19',
  phases: [{ name: 'Start', from: '2026-10-14', to: '2026-10-15' }],
  days: [
    { date: '2026-10-15', tasks: [{ id: 'cards', kind: 'cards' as const, title: 'Anker' }, { id: 'g', kind: 'grammar' as const, title: 'Dativ' }] },
    { date: '2026-10-14', tasks: [{ kind: 'grammar' as const, title: 'Präsens' }, { kind: 'speaking' as const, title: 'Sich vorstellen' }] },
    { date: '2026-11-19', type: 'exam' as const, tasks: [{ id: 'exam', kind: 'test' as const, title: 'Prüfung' }] },
  ],
};

describe('study plans', () => {
  it('counts days between calendar dates', () => {
    expect(daysBetween('2026-10-14', '2026-11-19')).toBe(36);
    expect(daysBetween('2026-11-19', '2026-10-14')).toBe(-36);
  });

  it('sorts days, generates task ids and rejects bad dates', () => {
    const p = buildPlan(input);
    expect(p.days.map((d) => d.date)).toEqual(['2026-10-14', '2026-10-15', '2026-11-19']);
    expect(p.days[0]!.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(p.active).toBe(true);
    expect(() => buildPlan({ ...input, days: [{ date: '14.10.2026', tasks: [] }] })).toThrow(/YYYY-MM-DD/);
  });

  it('keeps ticks on tasks that survive a rewrite', () => {
    const p = buildPlan(input);
    p.done[planTaskKey('2026-10-14', 't1')] = 1;
    p.done[planTaskKey('2026-10-15', 'g')] = 2;
    const next = buildPlan({ ...input, days: input.days.slice(1) }, p);
    expect(next.id).toBe(p.id);
    expect(next.done).toEqual({ [planTaskKey('2026-10-14', 't1')]: 1 });
  });

  it('ticks card tasks once the reviews are done and counts study days only', () => {
    const p = buildPlan(input);
    p.done[planTaskKey('2026-10-15', 'g')] = 1;
    const auto = cardsAutoDone(new Map([['2026-10-15', { count: 50 }]]), 50, '2026-10-16', false);
    const day = p.days[1]!;
    expect(dayProgress(p, day).complete).toBe(false);
    expect(dayProgress(p, day, auto).complete).toBe(true);
    expect(planProgress(p, auto)).toEqual({ complete: 1, total: 2 });
    const todayAuto = cardsAutoDone(new Map([['2026-10-15', { count: 3 }]]), 50, '2026-10-15', true);
    expect(todayAuto('2026-10-15')).toBe(true);
  });

  it('picks the newest active plan and describes today', () => {
    const a = { ...buildPlan(input), updatedAt: 1 };
    const b = { ...buildPlan({ ...input, title: 'B' }), updatedAt: 2 };
    expect(activePlan([a, b])?.title).toBe('B');
    expect(activePlan([{ ...b, active: false }, a])?.title).toBe('A2 plan');
    const text = describePlan(a, '2026-10-14');
    expect(text).toContain('36 days left');
    expect(text).toContain('[ ] grammar: Präsens');
  });
});
