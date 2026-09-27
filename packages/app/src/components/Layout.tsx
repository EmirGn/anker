import { PlusCircleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useIsWide, useSyncState } from '../lib/hooks';
import { uhrzeit } from '../lib/format';
import { isDesktop } from '../lib/platform';
import { Link, useRoute } from '../lib/router';
import { syncNow } from '../lib/sync';
import { BarChart3, BookOpen, CloudOff, Flame, Layers, LayoutGrid, Loader2, MessageCircle, RefreshCw, Search, Settings, Sparkles, Sun, Zap } from './icons';
import { Wordmark } from './Logo';
import { cx } from './ui';

export const NAV = [
  { to: '/', label: 'Heute', icon: Sun },
  { to: '/decks', label: 'Decks', icon: Layers },
  { to: '/add', label: 'Neue Karte', icon: PlusCircleIcon },
  { to: '/browse', label: 'Karten suchen', icon: Search },
  { to: '/practice', label: 'Üben', icon: Zap },
  { to: '/tutor', label: 'Tutor', icon: Sparkles },
  { to: '/stats', label: 'Statistik', icon: BarChart3 },
  { to: '/grammar', label: 'Grammatik', icon: BookOpen },
  { to: '/settings', label: 'Einstellungen', icon: Settings },
] as const;

function isActive(to: string, path: string) {
  if (to === '/') return path === '/';
  return path === to || path.startsWith(`${to}/`);
}

export function SyncPill({ compact }: { compact?: boolean }) {
  const s = useSyncState();
  if (s.status === 'disabled') return null;
  const bad = s.status === 'offline' || s.status === 'error';
  const icon = s.status === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : bad ? <CloudOff className="size-4" /> : <RefreshCw className="size-4" />;
  const label =
    s.status === 'syncing'
      ? 'Synchronisiert …'
      : s.status === 'offline'
        ? 'Mac nicht erreichbar'
        : s.status === 'error'
          ? 'Sync-Fehler'
          : s.pending
            ? `${s.pending} ausstehend`
            : 'Synchron';
  return (
    <button
      onClick={() => void syncNow()}
      title={s.error ?? (s.lastSync ? `Zuletzt synchronisiert um ${uhrzeit(s.lastSync)}` : '')}
      className={cx(
        'flex h-9 items-center gap-1.5 rounded-sm px-2 text-[13px] font-semibold transition-colors hover:bg-paper-sunk',
        bad ? 'text-koralle-ink' : 'text-ink-muted',
      )}
    >
      {icon}
      {!compact && label}
    </button>
  );
}

/** Streak badge: a sonne pill (sonne means "today and streak"). */
export function StreakBadge({ days }: { days: number }) {
  return (
    <span
      className={cx('inline-flex h-8 items-center gap-1 rounded-full px-3 text-[15px] font-bold tabular-nums', days > 0 ? 'bg-sonne text-on-sonne' : 'bg-paper-sunk text-ink-muted')}
      title="Tage in Folge"
    >
      <Flame weight="fill" className="size-[18px]" />
      {days}
    </span>
  );
}

function Sidebar({ due, streak }: { due: number; streak: number }) {
  const { path } = useRoute();
  return (
    <aside className={cx('thin-scroll flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper px-3 pb-4', isDesktop ? 'pt-11' : 'pt-6')}>
      {isDesktop && <div className="drag fixed top-0 left-0 h-10 w-[240px]" />}
      <Link to="/" className="no-drag mb-7 flex items-center px-2">
        <Wordmark size={34} />
      </Link>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = isActive(item.to, path);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cx(
                'flex h-11 items-center gap-3 rounded-md px-3 text-[15px] font-semibold transition-colors duration-[120ms]',
                active ? 'bg-hafen-soft text-hafen' : 'text-ink hover:bg-paper-sunk',
              )}
            >
              <Icon className={cx('size-6', active ? 'text-hafen' : 'text-ink-muted')} weight={active ? 'fill' : 'regular'} />
              <span className="flex-1">{item.label}</span>
              {item.to === '/' && due > 0 && <span className="rounded-full bg-ink px-2 text-[13px] leading-6 font-bold text-paper tabular-nums">{due}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center justify-between px-1 pt-6">
        <StreakBadge days={streak} />
        <SyncPill />
      </div>
    </aside>
  );
}

function BottomNav({ due }: { due: number }) {
  const { path } = useRoute();
  const items = [
    { to: '/', label: 'Heute', icon: Sun },
    { to: '/decks', label: 'Decks', icon: Layers },
    { to: '/add', label: 'Neu', icon: PlusCircleIcon },
    { to: '/tutor', label: 'Tutor', icon: MessageCircle },
    { to: '/more', label: 'Mehr', icon: LayoutGrid },
  ];
  const moreActive = ['/more', '/browse', '/practice', '/stats', '/grammar', '/settings', '/import'].some((p) => isActive(p, path));
  return (
    <nav className="pb-safe z-30 border-t border-line bg-paper-raised">
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around px-2">
        {items.map((item) => {
          const active = item.to === '/more' ? moreActive : isActive(item.to, path);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cx('relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[13px] leading-4', active ? 'font-bold text-hafen' : 'font-medium text-ink-muted')}
            >
              <Icon className="size-6" weight={active ? 'fill' : 'regular'} />
              {item.label}
              {item.to === '/' && due > 0 && (
                <span className="absolute top-1 left-1/2 ml-2.5 rounded-full bg-ink px-1.5 text-[11px] leading-4 font-bold text-paper tabular-nums">{due}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Layout({ children, due, streak }: { children: ReactNode; due: number; streak: number }) {
  const wide = useIsWide();
  const { path } = useRoute();
  const immersive = path.startsWith('/study') || path.startsWith('/practice/') || path === '/quick-add' || path === '/connect' || path === '/welcome';
  if (wide) {
    return (
      <div className="flex h-full" lang="de">
        {!immersive && <Sidebar due={due} streak={streak} />}
        <main className="thin-scroll relative min-w-0 flex-1 overflow-y-auto">
          {isDesktop && <div className="drag sticky top-0 z-20 -mb-8 h-8" />}
          {children}
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col" lang="de">
      <main className="thin-scroll pt-safe relative min-h-0 flex-1 overflow-y-auto">{children}</main>
      {!immersive && <BottomNav due={due} />}
    </div>
  );
}
