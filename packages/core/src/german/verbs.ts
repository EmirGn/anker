export interface VerbForms {
  present3?: string;
  preterite?: string;
  perfect?: string;
  aux?: 'haben' | 'sein';
  participle?: string;
}

/** Parse "fährt · fuhr · ist gefahren" (also accepts , ; / – as separators). */
export function parseVerbForms(forms: string | undefined | null): VerbForms {
  const raw = (forms ?? '').trim();
  if (!raw) return {};
  const parts = raw
    .split(/\s*[·,;/|–—]\s*|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: VerbForms = {};
  if (parts[0]) out.present3 = parts[0];
  if (parts[1]) out.preterite = parts[1];
  if (parts[2]) {
    out.perfect = parts[2];
    const m = parts[2].match(/^(hat|ist|haben|sein)\s+(.+)$/i);
    if (m) {
      out.aux = /^(ist|sein)$/i.test(m[1]!) ? 'sein' : 'haben';
      out.participle = m[2]!.trim();
    } else {
      out.participle = parts[2];
    }
  }
  return out;
}

export function formatVerbForms(f: VerbForms): string {
  const perfect = f.perfect ?? (f.participle ? `${f.aux === 'sein' ? 'ist' : 'hat'} ${f.participle}` : undefined);
  return [f.present3, f.preterite, perfect].filter(Boolean).join(' · ');
}
