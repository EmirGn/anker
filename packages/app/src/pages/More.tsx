import { BarChart3, BookOpen, ChevronRight, Import, Search, Settings, Zap } from '../components/icons';
import { SyncPill } from '../components/Layout';
import { PageHeader, Panel } from '../components/ui';
import { Link } from '../lib/router';
import { tr } from '../lib/i18n';

const ITEMS = [
  { to: '/browse', label: tr('Karten suchen'), desc: tr('Alle Karten finden und bearbeiten'), icon: Search },
  { to: '/practice', label: tr('Üben'), desc: tr('Artikel-Blitz, Zahlen, Uhrzeit, Fälle …'), icon: Zap },
  { to: '/stats', label: tr('Statistik'), desc: tr('Kalender, Trefferquote, Prognose'), icon: BarChart3 },
  { to: '/grammar', label: tr('Grammatik'), desc: tr('Tabellen und Regeln auf einen Blick'), icon: BookOpen },
  { to: '/import', label: tr('Import & Export'), desc: tr('Anki-Decks, CSV, Sicherungen'), icon: Import },
  { to: '/settings', label: tr('Einstellungen'), desc: tr('Sync, KI, Stimme, Lernoptionen'), icon: Settings },
];

export function More() {
  return (
    <div className="mx-auto max-w-xl px-5 pt-8 pb-10">
      <PageHeader title={tr('Mehr')} actions={<SyncPill />} />
      <Panel className="divide-y divide-line overflow-hidden">
        {ITEMS.map((it) => (
          <Link key={it.to} to={it.to} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-paper-sunk">
            <span className="flex size-10 items-center justify-center rounded-md bg-paper-sunk text-ink">
              <it.icon className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-label block">{it.label}</span>
              <span className="t-caption block truncate text-ink-muted">{it.desc}</span>
            </span>
            <ChevronRight className="size-5 text-ink-muted" />
          </Link>
        ))}
      </Panel>
    </div>
  );
}
