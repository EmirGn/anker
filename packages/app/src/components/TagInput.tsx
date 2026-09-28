import { X } from './icons';
import { useState } from 'react';
import { cx } from './ui';
import { tr } from '../lib/i18n';

export function TagInput({ value, onChange, placeholder = tr('Tags hinzufügen …'), className }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState('');
  const commit = (raw: string) => {
    const parts = raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div
      className={cx(
        'flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-transparent bg-paper-sunk px-2.5 py-1.5 field-focus',
        className,
      )}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-sm bg-paper-sunk py-0.5 pr-1 pl-2 text-[13px] font-medium">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded-xs p-0.5 text-ink-muted hover:text-ink" aria-label={tr('{0} entfernen', t)}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (/[\s,]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length ? '' : placeholder}
        className="h-7 min-w-24 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}
