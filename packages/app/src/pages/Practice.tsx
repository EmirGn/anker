import { Trophy } from '../components/icons';
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
    <div className="mx-auto max-w-4xl px-5 pt-8 pb-10 md:px-8 md:pt-10">
      <PageHeader title="Üben" subtitle="Kurze Spiele für die kniffligen Stellen im Deutschen. Sie ändern deinen Wiederholungsplan nicht." />
      <div className="grid gap-3 sm:grid-cols-2">
        {DRILLS.map((d) => {
          const Icon = d.icon;
          const best = bests?.get(d.id);
          return (
            <Link
              key={d.id}
              to={`/practice/${d.id}`}
              className="flex items-start gap-3 rounded-md border border-line bg-paper-raised p-4 transition-colors duration-[120ms] hover:bg-paper-sunk"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-md" style={{ background: d.tint.bg, color: d.tint.fg }}>
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="t-heading">{d.title}</div>
                <div className="mt-1 text-[15px] text-ink-muted">{d.desc}</div>
                {best !== undefined && (
                  <div className="t-caption mt-2 inline-flex items-center gap-1 text-ink-muted">
                    <Trophy className="size-4" /> Rekord: {best}
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
