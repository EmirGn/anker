import {
  BarChart3,
  BookOpen,
  CloudOff,
  Flame,
  LayoutGrid,
  Layers,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useIsWide, useSyncState } from '../lib/hooks';
import { isDesktop } from '../lib/platform';
import { Link, useRoute } from '../lib/router';
import { syncNow } from '../lib/sync';
import { Logo } from './Logo';
import { cx } from './ui';

export const NAV = [
  { to: '/', label: 'Today', icon: Sun },
  { to: '/decks', label: 'Decks', icon: Layers },
  { to: '/add', label: 'Add', icon: Plus },
  { to: '/browse', label: 'Browse', icon: Search },
  { to: '/practice', label: 'Practice', icon: Zap },
  { to: '/tutor', label: 'Tutor', icon: Sparkles },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/grammar', label: 'Grammar', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function isActive(to: string, path: string) {
  if (to === '/') return path === '/';
  return path === to || path.startsWith(`${to}/`);
}


export function SyncPill({ compact }: { compact?: boolean }) {
  const s = useSyncState();
  if (s.status === 'disabled') return null;
  const icon =
    s.status === 'syncing' ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : s.status === 'offline' || s.status === 'error' ? (
      <CloudOff className="size-3.5" />
    ) : (
      <RefreshCw className="size-3.5" />
    );
  const label =
    s.status === 'syncing' ? 'Syncing…' : s.status === 'offline' ? 'Hub offline' : s.status === 'error' ? 'Sync error' : s.pending ? `${s.pending} to sync` : 'Synced';
  return (
    <button
      onClick={() => void syncNow()}
      title={s.error ?? (s.lastSync ? `Last sync ${new Date(s.lastSync).toLocaleTimeString()}` : '')}
      className={cx(
        'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-2',
        s.status === 'error' || s.status === 'offline' ? 'text-hard' : 'text-faint',
      )}
    >
      {icon}
      {!compact && label}
    </button>
  );
}

function Sidebar({ due, streak }: { due: number; streak: number }) {
  const { path } = useRoute();
  return (
    <aside className={cx('thin-scroll flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/60 px-3 pb-4', isDesktop ? 'pt-11' : 'pt-5')}>
      {isDesktop && <div className="drag fixed top-0 left-0 h-10 w-[232px]" />}
      <Link to="/" className="no-drag mb-6 flex items-center gap-2.5 px-2">
        <Logo size={30} />
        <span className="font-display text-[21px] font-semibold tracking-tight">Anker</span>
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
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors',
                active ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Icon className={cx('size-[18px]', active ? 'text-accent-strong' : 'text-faint group-hover:text-muted')} strokeWidth={2} />
              <span className="flex-1">{item.label}</span>
              {item.to === '/' && due > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-ink">{due}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center justify-between px-1 pt-6">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted" title="Day streak">
          <Flame className={cx('size-4', streak > 0 ? 'text-hard' : 'text-faint')} />
          {streak}
        </div>
        <SyncPill />
      </div>
    </aside>
  );
}

function BottomNav({ due }: { due: number }) {
  const { path } = useRoute();
  const items = [
    { to: '/', label: 'Today', icon: Sun },
    { to: '/decks', label: 'Decks', icon: Layers },
    { to: '/add', label: 'Add', icon: Plus, center: true },
    { to: '/tutor', label: 'Tutor', icon: MessageCircle },
    { to: '/more', label: 'More', icon: LayoutGrid },
  ];
  const moreActive = ['/more', '/browse', '/practice', '/stats', '/grammar', '/settings', '/import'].some((p) => isActive(p, path));
  return (
    <nav className="pb-safe z-30 border-t border-line bg-surface/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around px-2">
        {items.map((item) => {
          const active = item.to === '/more' ? moreActive : isActive(item.to, path);
          const Icon = item.icon;
          if (item.center)
            return (
              <Link key={item.to} to={item.to} className="flex flex-1 items-center justify-center" aria-label="Add card">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-md shadow-accent/30 transition-transform active:scale-95">
                  <Plus className="size-6" strokeWidth={2.5} />
                </span>
              </Link>
            );
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cx('relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium', active ? 'text-ink' : 'text-faint')}
            >
              <Icon className={cx('size-[22px]', active && 'text-accent-strong')} strokeWidth={active ? 2.3 : 2} />
              {item.label}
              {item.to === '/' && due > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 rounded-full bg-accent px-1.5 text-[10px] leading-4 font-bold text-accent-ink">{due}</span>
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
      <div className="flex h-full">
        {!immersive && <Sidebar due={due} streak={streak} />}
        <main className="thin-scroll relative min-w-0 flex-1 overflow-y-auto">
          {isDesktop && <div className="drag sticky top-0 z-20 -mb-8 h-8" />}
          {children}
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <main className="thin-scroll pt-safe relative min-h-0 flex-1 overflow-y-auto">{children}</main>
      {!immersive && <BottomNav due={due} />}
    </div>
  );
}
