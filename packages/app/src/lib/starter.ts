import { makeDeck, starterDeckId, STARTER_DECKS, type Deck } from '@anker/core';
import { db } from './db';
import { addNotes, commit } from './repo';

/** Install starter decks. Ids are deterministic, so installing on several devices never duplicates. */
export async function installStarterDecks(keys: string[]): Promise<number> {
  const decks = await db.decks.toArray();
  const newDecks: Deck[] = [];
  let added = 0;
  const now = Date.now();
  for (const key of keys) {
    const spec = STARTER_DECKS.find((d) => d.key === key);
    if (!spec) continue;
    const parts = spec.path.split('::');
    let parentId: string | null = null;
    let prefix = '';
    parts.forEach((part, i) => {
      prefix = prefix ? `${prefix}::${part}` : part;
      let d = decks.find((x) => x.parentId === parentId && x.name.toLowerCase() === part.toLowerCase());
      if (!d) {
        const last = i === parts.length - 1;
        d = makeDeck({
          id: starterDeckId(prefix),
          name: part,
          parentId,
          now,
          emoji: last ? spec.emoji : i === 0 ? '🇩🇪' : undefined,
          description: last ? spec.description : undefined,
        });
        decks.push(d);
        newDecks.push(d);
      }
      parentId = d.id;
    });
    if (newDecks.length) await commit([{ table: 'decks', put: newDecks.splice(0) }]);
    const notes = spec.notes();
    const existing = new Set(await db.notes.where('id').anyOf(notes.map((n) => n.id)).primaryKeys());
    const r = await addNotes(
      notes
        .filter((n) => !existing.has(n.id))
        .map((n) => ({ id: n.id, deckId: parentId!, type: n.type, fields: n.fields, tags: n.tags, source: 'starter' as const })),
    );
    added += r.added;
  }
  return added;
}
