import { X } from 'lucide-react';
import { useState } from 'react';
import { cx } from './ui';

export function TagInput({ value, onChange, placeholder = 'Add tags…', className }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string }) {
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
        'flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 py-1.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15',
        className,
      )}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-0.5 pr-1 pl-2 text-[13px] font-medium">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 text-faint hover:text-ink" aria-label={`Remove ${t}`}>
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
        className="h-7 min-w-24 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
      />
    </div>
  );
}
