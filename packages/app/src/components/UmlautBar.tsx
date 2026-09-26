import { cx } from './ui';

const CHARS = ['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'];

/** Insert umlauts at the caret of the given (or last focused) input. */
export function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, text: string, setValue: (v: string) => void) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
}

export function UmlautBar({ onInsert, className }: { onInsert: (ch: string) => void; className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-1', className)}>
      {CHARS.map((c) => (
        <button
          key={c}
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(c)}
          className="h-8 min-w-8 rounded-lg border border-line bg-surface px-2 text-[15px] font-medium text-muted transition-colors hover:border-accent hover:text-ink"
        >
          {c}
        </button>
      ))}
    </div>
  );
}
