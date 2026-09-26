import { escapeHtml } from './text';

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) {
    const n = Number(m[1]);
    if (n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Render cloze text for card `num` (1-based).
 * question: the active deletion becomes [hint] / […]; answer: it is highlighted.
 */
export function renderCloze(text: string, num: number, side: 'question' | 'answer'): string {
  return text.replace(CLOZE_RE, (_m, n: string, content: string, hint?: string) => {
    if (Number(n) !== num) return content;
    if (side === 'question') {
      const label = hint ? escapeHtml(hint) : '…';
      return `<span class="cloze">[${label}]</span>`;
    }
    return `<span class="cloze-answer">${content}</span>`;
  });
}

/** The hidden answers for cloze card `num` (for type-in mode). */
export function clozeAnswers(text: string, num: number): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CLOZE_RE)) if (Number(m[1]) === num) out.push(m[2] ?? '');
  return out;
}

export function clozeToPlain(text: string): string {
  return text.replace(CLOZE_RE, (_m, _n, content: string) => content);
}
