// Compare a typed answer with the expected one (Anki-style type-in feedback).
export type DiffSeg = { kind: 'ok' | 'wrong' | 'missing'; text: string };

function lcsTable(a: string, b: string): number[][] {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  return t;
}

/** Segments of the typed text (ok/wrong) and of the expected text (ok/missing). */
export function diffAnswer(typed: string, expected: string): { typed: DiffSeg[]; expected: DiffSeg[] } {
  const a = typed;
  const b = expected;
  const t = lcsTable(a, b);
  const ta: DiffSeg[] = [];
  const tb: DiffSeg[] = [];
  const push = (arr: DiffSeg[], kind: DiffSeg['kind'], ch: string) => {
    const last = arr[arr.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else arr.push({ kind, text: ch });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(ta, 'ok', a[i]!);
      push(tb, 'ok', b[j]!);
      i++;
      j++;
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) {
      push(ta, 'wrong', a[i++]!);
    } else {
      push(tb, 'missing', b[j++]!);
    }
  }
  while (i < a.length) push(ta, 'wrong', a[i++]!);
  while (j < b.length) push(tb, 'missing', b[j++]!);
  return { typed: ta, expected: tb };
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
const fold = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.,!?;:"'„“”‚‘’]/g, '');

export type Verdict = 'exact' | 'close' | 'wrong';

/** exact: identical; close: only case/umlaut/punctuation differences; wrong otherwise. */
export function judgeAnswer(typed: string, expected: string): Verdict {
  if (!typed.trim()) return 'wrong';
  const alts = expected.split(/\s*[;/]\s*|\s*,\s*(?=\S)/).filter(Boolean);
  const candidates = [expected, ...(alts.length > 1 ? alts : [])];
  if (candidates.some((c) => norm(c) === norm(typed))) return 'exact';
  if (candidates.some((c) => fold(c) === fold(typed))) return 'close';
  return 'wrong';
}
