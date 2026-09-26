import { createElement, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';

export interface RouteState {
  path: string;
  query: URLSearchParams;
  raw: string;
}

function read(): RouteState {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, q] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(q ?? ''), raw };
}

let current = read();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = read();
  listeners.forEach((f) => f());
});

export function useRoute(): RouteState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) {
    history.replaceState(null, '', `#${to}`);
    current = read();
    listeners.forEach((f) => f());
  } else {
    window.location.hash = to;
  }
}

export function goBack(fallback = '/') {
  if (history.length > 1 && document.referrer !== undefined && window.history.state !== undefined) history.back();
  else navigate(fallback);
}

/** match('/edit/:id', '/edit/abc') → { id: 'abc' } */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) out[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}

export function Link({ to, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return createElement('a', { href: `#${to}`, ...rest });
}
