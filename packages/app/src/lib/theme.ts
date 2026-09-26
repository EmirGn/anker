export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'anker-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolvedTheme(pref = getThemePref()): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const listeners = new Set<() => void>();

export function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', t === 'dark' ? '#0e1116' : '#f6f3ee'));
  void import('./platform').then(async ({ isNative }) => {
    if (!isNative) return;
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: t === 'dark' ? Style.Dark : Style.Light });
    } catch {
      // ignore
    }
  });
  listeners.forEach((fn) => fn());
}

export function setThemePref(p: ThemePref) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // ignore
  }
  applyTheme();
}

export function onThemeChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme();
  });
}
