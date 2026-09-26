import { BarChart3, BookOpen, ChevronRight, Import, Search, Settings, Zap } from 'lucide-react';
import { SyncPill } from '../components/Layout';
import { PageHeader, Panel } from '../components/ui';
import { Link } from '../lib/router';

const ITEMS = [
  { to: '/browse', label: 'Browse', desc: 'Search and edit all your cards', icon: Search },
  { to: '/practice', label: 'Practice', desc: 'Artikel-Blitz, numbers, time, cases…', icon: Zap },
  { to: '/stats', label: 'Statistics', desc: 'Heatmap, retention, forecast', icon: BarChart3 },
  { to: '/grammar', label: 'Grammar', desc: 'Tables & rules at a glance', icon: BookOpen },
  { to: '/import', label: 'Import & export', desc: 'Anki decks, CSV, backups', icon: Import },
  { to: '/settings', label: 'Settings', desc: 'Sync, AI, voice, study options', icon: Settings },
];

export function More() {
  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-10">
      <PageHeader title="Mehr" actions={<SyncPill />} />
      <Panel className="divide-y divide-line overflow-hidden">
        {ITEMS.map((it) => (
          <Link key={it.to} to={it.to} className="flex items-center gap-4 px-4 py-3.5 active:bg-surface-2">
            <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-accent-strong">
              <it.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{it.label}</span>
              <span className="block truncate text-[13px] text-muted">{it.desc}</span>
            </span>
            <ChevronRight className="size-5 text-faint" />
          </Link>
        ))}
      </Panel>
    </div>
  );
}
