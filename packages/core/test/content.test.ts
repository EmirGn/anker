import { describe, expect, it } from 'vitest';
import { builtinNouns, builtinVerbs, makeNote, noteOrds, parseVerbForms, STARTER_DECKS, validateNote } from '../src/index';

describe('starter content', () => {
  it('every starter note is valid and ids are unique', () => {
    const ids = new Set<string>();
    for (const deck of STARTER_DECKS) {
      const notes = deck.notes();
      expect(notes.length).toBe(deck.count);
      for (const n of notes) {
        expect(ids.has(n.id), `duplicate id ${n.id}`).toBe(false);
        ids.add(n.id);
        const { note, cards } = makeNote({ deckId: 'd', type: n.type, fields: n.fields, tags: n.tags, id: n.id }, 0);
        expect(validateNote(note), n.id).toBeNull();
        expect(cards.length).toBe(noteOrds(note).length);
      }
    }
    expect(ids.size).toBeGreaterThan(300);
  });

  it('nouns have a gender and verbs parse into three forms', () => {
    for (const n of builtinNouns()) expect(['der', 'die', 'das', 'pl']).toContain(n.gender);
    for (const v of builtinVerbs()) {
      const f = parseVerbForms(v.forms);
      expect(f.present3, v.infinitive).toBeTruthy();
      expect(f.preterite, v.infinitive).toBeTruthy();
      expect(f.aux, v.infinitive).toMatch(/haben|sein/);
    }
  });
});
