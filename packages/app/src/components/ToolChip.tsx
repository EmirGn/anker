// A tool call by the AI (Anker's MCP tools), as a chip that expands to its raw input/output.
import { useState } from 'react';
import { tr } from '../lib/i18n';
import { Check, ChevronDown, Loader2, Wrench, X } from './icons';
import { cx } from './ui';

function tryJson(s?: string): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toolLabel(name: string, input: any, output?: string, status?: string): string {
  const out = tryJson(output);
  const running = status === 'running';
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  switch (name) {
    case 'get_overview':
      return running ? tr('Schaut sich deine Decks an …') : tr('Deine Decks angesehen');
    case 'list_decks':
      return tr('Decks aufgelistet');
    case 'create_deck':
      return tr('Deck {0} {1}', out?.path ?? input?.path ?? '', running ? tr('wird erstellt') : tr('erstellt'));
    case 'update_deck':
      return tr('Deck {0} aktualisiert', out?.path ?? input?.deck ?? '');
    case 'delete_deck':
      return tr('Deck {0} gelöscht', input?.deck ?? '');
    case 'add_words':
    case 'add_notes': {
      const count = out?.added ?? n(input?.words ?? input?.notes);
      const words = name === 'add_words';
      const deck = out?.deck ?? input?.deck ?? '…';
      if (running) return words ? tr('Fügt {0} Wörter zu {1} hinzu', count, deck) : tr('Fügt {0} Notizen zu {1} hinzu', count, deck);
      const skipped = out?.skippedDuplicates?.length ? tr(' · {0} Duplikate übersprungen', out.skippedDuplicates.length) : '';
      return words ? tr('{0} Wörter zu {1} hinzugefügt{2}', count, deck, skipped) : tr('{0} Notizen zu {1} hinzugefügt{2}', count, deck, skipped);
    }
    case 'find_notes':
      return tr('„{0}“ gesucht{1}', input?.query ?? '', out ? tr(' · {0} gefunden', out.total) : '');
    case 'get_notes':
      return tr('{0} Notizen gelesen', n(input?.ids));
    case 'lookup_words':
      return tr('{0} Wörter auf Duplikate geprüft', n(input?.words));
    case 'update_notes':
      return tr('{0} Notizen {1}', out?.updated ?? n(input?.updates), running ? tr('werden aktualisiert') : tr('aktualisiert'));
    case 'move_notes':
      return tr('{0} Notizen nach {1} verschoben', out?.moved ?? n(input?.ids), out?.deck ?? input?.deck ?? '');
    case 'delete_notes':
      return tr('{0} Notizen gelöscht', out?.deleted ?? n(input?.ids));
    case 'set_card_state':
      return tr('Kartenstatus von {0} Notizen geändert{1}', n(input?.note_ids), input?.action ? ` (${String(input.action)})` : '');
    case 'get_study_stats':
      return running ? tr('Analysiert deine Statistik …') : tr('Deine Statistik analysiert');
    default:
      return name;
  }
}

export function ToolChip({ name, input, output, status }: { name: string; input?: unknown; output?: string; status: 'running' | 'ok' | 'error' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex min-h-9 max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-[13px] font-medium',
          status === 'error' ? 'border-transparent bg-koralle-soft text-koralle-ink' : 'border-line bg-paper-raised text-ink-muted',
        )}
      >
        {status === 'running' ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : status === 'ok' ? <Check className="size-3.5 shrink-0 text-wiese" /> : <X className="size-3.5 shrink-0" />}
        <Wrench className="size-3 shrink-0 opacity-50" />
        <span className="truncate">{toolLabel(name, input, output, status)}</span>
        <ChevronDown className={cx('size-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <pre className="thin-scroll mt-1.5 max-h-72 overflow-auto rounded-md bg-paper-sunk p-3 text-[11px] leading-relaxed text-ink-muted">
          {input ? `→ ${JSON.stringify(input, null, 1)}\n\n` : ''}
          {output ? `← ${output}` : ''}
        </pre>
      )}
    </div>
  );
}
