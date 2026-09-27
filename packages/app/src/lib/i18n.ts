// UI language. The German UI text is the source (and the key); English comes
// from the dictionary in i18n-en.ts. The language is read once at startup and
// switching it reloads the app, so module-level labels pick it up too.
import { desktop } from './desktop';
import { EN } from './i18n-en';

export type Lang = 'en' | 'de';

const KEY = 'anker-lang';

function detect(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'de') return v;
  } catch {
    // storage unavailable
  }
  return 'en';
}

export const lang: Lang = detect();
export const LOCALE = lang === 'de' ? 'de-DE' : 'en-GB';

if (typeof document !== 'undefined') document.documentElement.lang = lang;
void desktop?.setLanguage?.(lang);

const missing = new Set<string>();

/** Translate a German UI string; `{0}`, `{1}` … are filled from `args`. */
export function tr(de: string, ...args: unknown[]): string {
  let s = de;
  if (lang === 'en') {
    const en = EN[de];
    if (en !== undefined) s = en;
    else if (import.meta.env?.DEV && !missing.has(de)) {
      missing.add(de);
      console.warn('[i18n] missing English for:', de);
    }
  }
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : s;
}

/** Switch the UI language (reloads the app). */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore
  }
  void desktop?.setLanguage?.(next);
  location.reload();
}
