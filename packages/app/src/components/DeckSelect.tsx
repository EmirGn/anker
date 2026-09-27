import { buildDeckTree, flattenTree } from '@anker/core';
import { useMemo } from 'react';
import { useDecks } from '../lib/hooks';
import { Select } from './ui';

export function useDeckOptions() {
  const decks = useDecks();
  return useMemo(() => (decks ? flattenTree(buildDeckTree(decks)).map((n) => ({ id: n.deck.id, path: n.path, depth: n.depth, emoji: n.deck.emoji })) : []), [decks]);
}

export function DeckSelect({
  value,
  onChange,
  className,
  allowNone,
  noneLabel = 'Alle Decks',
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const options = useDeckOptions();
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {allowNone && <option value="">{noneLabel}</option>}
      {!allowNone && !value && <option value="">Deck wählen …</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {'  '.repeat(o.depth)}
          {o.path.split('::').pop()}
        </option>
      ))}
    </Select>
  );
}
