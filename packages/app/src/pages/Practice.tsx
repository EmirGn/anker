import { Trophy } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { db } from '../lib/db';
import { useLiveQuery } from '../lib/hooks';
import { Link } from '../lib/router';
import { DRILLS } from './Today';

export function Practice() {
  const bests = useLiveQuery(async () => {
    const rows = await db.meta.where('key').startsWith('best:').toArray();
    return new Map(rows.map((r) => [r.key.slice(5), r.value as number]));
  }, []);
  return (
    <div className="mx-auto max-w-4xl px-4 pt-6 pb-10 md:px-8 md:pt-10">
      <PageHeader title="Üben" subtitle="Quick games that train the tricky parts of German. They don't affect your review schedule." />
      <div className="grid gap-3 sm:grid-cols-2">
        {DRILLS.map((d) => {
          const Icon = d.icon;
          const best = bests?.get(d.id);
          return (
            <Link
              key={d.id}
              to={`/practice/${d.id}`}
              className="group flex items-start gap-4 rounded-2xl border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:shadow-card"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${d.color} 15%, transparent)`, color: d.color }}>
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[19px] font-semibold">{d.title}</div>
                <div className="mt-0.5 text-[14px] text-muted">{d.desc}</div>
                {best !== undefined && (
                  <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-faint">
                    <Trophy className="size-3.5" /> Best: {best}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
