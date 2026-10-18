import { describe, expect, it } from 'vitest';
import {
  buildWordIndex,
  entryFromAi,
  expandPlural,
  guessLanguage,
  headwordKey,
  lemmaCandidates,
  lookupInText,
  sentenceAt,
  separablePrefix,
  tokenizeGerman,
  unumlaut,
  WordIndex,
  type Note,
} from '../src/index';

let n = 0;
function word(fields: Record<string, string>): Pick<Note, 'id' | 'type' | 'fields' | 'deckId'> {
  return { id: `n${++n}`, type: 'word', deckId: 'd1', fields };
}

// A small collection like the learner's own word notes.
const NOTES = [
  word({ german: 'schlafen', english: 'to sleep', pos: 'verb', forms: 'schläft · schlief · hat geschlafen' }),
  word({ german: 'lange', english: 'for a long time', pos: 'adverb' }),
  word({ german: 'lang', english: 'long', pos: 'adjective', forms: 'länger · am längsten' }),
  word({ german: 'Wochenende', english: 'weekend', pos: 'noun', gender: 'das', plural: 'Wochenenden' }),
  word({ german: 'fahren', english: 'to drive, to go', pos: 'verb', forms: 'fährt · fuhr · ist gefahren' }),
  word({ german: 'gehen', english: 'to go, to walk', pos: 'verb', forms: 'geht · ging · ist gegangen' }),
  word({ german: 'Haus', english: 'house', pos: 'noun', gender: 'das', plural: 'Häuser' }),
  word({ german: 'klein', english: 'small', pos: 'adjective', forms: 'kleiner · am kleinsten' }),
  word({ german: 'aufstehen', english: 'to get up', pos: 'verb', forms: 'steht auf · stand auf · ist aufgestanden' }),
  word({ german: 'einkaufen', english: 'to go shopping', pos: 'verb', forms: 'kauft ein · kaufte ein · hat eingekauft' }),
  word({ german: 'wehtun', english: 'to hurt', pos: 'verb', forms: 'tut weh · tat weh · hat wehgetan' }),
  word({ german: 'sich gewöhnen an', english: 'to get used to', pos: 'verb', forms: 'gewöhnt sich · gewöhnte sich · hat sich gewöhnt' }),
  word({ german: 'Essen', english: 'food; meal', pos: 'noun', gender: 'das', plural: '-' }),
  word({ german: 'essen', english: 'to eat', pos: 'verb', forms: 'isst · aß · hat gegessen' }),
  word({ german: 'Buch', english: 'book', gender: 'das', plural: '¨-er' }),
  word({ german: 'arbeiten', english: 'to work', pos: 'verb', forms: 'arbeitet · arbeitete · hat gearbeitet' }),
  word({ german: 'groß', english: 'big', pos: 'adjective', forms: 'größer · am größten' }),
];

const index = buildWordIndex(NOTES);
const top = (w: string, ctx?: { particle?: string; sentenceStart?: boolean }) => index.lookup(w, ctx)[0]?.entry;
const lemma = (w: string, ctx?: { particle?: string; sentenceStart?: boolean }) => top(w, ctx)?.lemma;

describe('lemmatizer rules', () => {
  it('proposes infinitives, singulars and base adjectives', () => {
    const forms = (w: string) => lemmaCandidates(w).map((c) => c.form);
    expect(forms('schlafe')).toContain('schlafen');
    expect(forms('arbeitest')).toContain('arbeiten');
    expect(forms('wandert')).toContain('wandern');
    expect(forms('gekauft')).toContain('kaufen');
    expect(forms('geschlafen')).toContain('schlafen');
    expect(forms('eingekauft')).toContain('einkaufen');
    expect(forms('aufzustehen')).toContain('aufstehen');
    expect(forms('Häuser')).toContain('haus');
    expect(forms('Mütter')).toContain('mutter');
    expect(forms('kleinen')).toContain('klein');
    expect(forms('größere')).toContain('groß');
    expect(lemmaCandidates('Haus')[0]).toMatchObject({ form: 'haus', rule: 'exact', cost: 0 });
  });

  it('handles umlauts, plurals and separable prefixes', () => {
    expect(unumlaut('häuser')).toBe('hauser');
    expect(unumlaut('haus')).toBeNull();
    expect(expandPlural('Haus', 'Häuser')).toBe('Häuser');
    expect(expandPlural('Buch', '¨-er')).toBe('Bücher');
    expect(expandPlural('Tisch', '-e')).toBe('Tische');
    expect(expandPlural('Haus', 'die Häuser')).toBe('Häuser');
    expect(expandPlural('Essen', '-')).toBeNull();
    expect(separablePrefix('aufstehen')).toBe('auf');
    expect(separablePrefix('kennenlernen')).toBe('kennen');
    expect(separablePrefix('schlafen')).toBeNull();
    expect(headwordKey('sich gewöhnen an', 'verb')).toBe('gewöhnen');
    expect(headwordKey('der Tisch')).toBe('tisch');
  });
});

describe('word lookup', () => {
  it('resolves the examples from the brief', () => {
    expect(lemma('schlafe')).toBe('schlafen');
    expect(lemma('lange')).toBe('lange');
    expect(top('lange')?.pos).toBe('adverb');
    expect(lemma('Wochenende')).toBe('Wochenende');
    expect(top('Wochenende')?.gender).toBe('das');
    expect(lemma('fährt')).toBe('fahren');
    expect(lemma('ging')).toBe('gehen');
    expect(lemma('Häuser')).toBe('Haus');
    expect(lemma('kleinen')).toBe('klein');
    expect(lemma('gefahren')).toBe('fahren');
  });

  it('covers more inflected forms', () => {
    expect(lemma('fährst')).toBe('fahren');
    expect(lemma('fuhren')).toBe('fahren');
    expect(lemma('gingen')).toBe('gehen');
    expect(lemma('Wochenenden')).toBe('Wochenende');
    expect(lemma('Häusern')).toBe('Haus');
    expect(lemma('Bücher')).toBe('Buch');
    expect(lemma('kleiner')).toBe('klein');
    expect(lemma('kleinsten')).toBe('klein');
    expect(lemma('größten')).toBe('groß');
    expect(lemma('längere')).toBe('lang');
    expect(lemma('arbeitest')).toBe('arbeiten');
    expect(lemma('gearbeitet')).toBe('arbeiten');
    expect(lemma('aufgestanden')).toBe('aufstehen');
    expect(lemma('eingekauft')).toBe('einkaufen');
    expect(lemma('gewöhnt')).toBe('sich gewöhnen an');
  });

  it('tells nouns from verbs by capitalisation', () => {
    expect(top('Essen')?.pos).toBe('noun');
    expect(top('essen')?.pos).toBe('verb');
    // At the start of a sentence a capital letter says nothing.
    expect(index.lookup('Essen', { sentenceStart: true }).map((m) => m.entry.pos)).toEqual(expect.arrayContaining(['noun', 'verb']));
  });

  it('knows the little words and irregular verbs out of the box', () => {
    const empty = buildWordIndex([]);
    expect(empty.lookup('bin')[0]?.entry.lemma).toBe('sein');
    expect(empty.lookup('hatte')[0]?.entry.lemma).toBe('haben');
    expect(empty.lookup('kannst')[0]?.entry.lemma).toBe('können');
    expect(empty.lookup('im')[0]?.entry.english).toMatch(/in the/);
    expect(empty.lookup('meinem')[0]?.entry.lemma).toBe('mein');
    expect(empty.lookup('mit')[0]?.entry.forms).toBe('+ Dativ');
    // Grundwortschatz entries ship with the app
    expect(empty.lookup('schläft')[0]?.entry.lemma).toBe('schlafen');
    expect(empty.lookup('Kinder')[0]?.entry.lemma).toBe('Kind');
  });

  it("prefers the learner's own note over the built-in copy", () => {
    const m = index.lookup('schlafe');
    expect(m[0]?.entry.source).toBe('note');
    expect(m.filter((x) => x.entry.lemma === 'schlafen')).toHaveLength(1);
  });

  it('returns nothing for unknown words', () => {
    expect(index.lookup('Quantenverschränkung')).toEqual([]);
  });
});

describe('lookup in context', () => {
  const at = (text: string, word: string) => lookupInText(index, text, text.indexOf(word))!;

  it('finds the word under an offset', () => {
    const text = 'Am Wochenende schlafe ich lange.';
    expect(at(text, 'schlafe').matches[0]?.entry.lemma).toBe('schlafen');
    expect(at(text, 'lange').matches[0]?.entry.lemma).toBe('lange');
    expect(at(text, 'Wochenende').word).toBe('Wochenende');
    expect(lookupInText(index, text, text.length - 1)).toBeNull(); // the full stop
  });

  it('joins separable verbs with the particle at the end of the clause', () => {
    const text = 'Ich stehe jeden Tag früh auf, aber heute nicht.';
    const m = at(text, 'stehe').matches[0]!;
    expect(m.entry.lemma).toBe('aufstehen');
    expect(m.particle).toBe('auf');
    expect(at('Er steht um sieben auf.', 'steht').matches[0]?.entry.lemma).toBe('aufstehen');
    expect(at('Ich kaufe im Supermarkt ein.', 'kaufe').matches[0]?.entry.lemma).toBe('einkaufen');
    expect(at('Mein Kopf tut weh.', 'tut').matches[0]?.entry.lemma).toBe('wehtun');
    // Tapping the particle finds the verb
    expect(at('Ich stehe früh auf.', 'auf').matches[0]?.entry.lemma).toBe('aufstehen');
  });

  it('does not join a particle from another clause', () => {
    const r = at('Ich schlafe, er steht auf.', 'schlafe');
    expect(r.matches[0]?.entry.lemma).toBe('schlafen');
  });

  it('uses sentence position for capitalised words', () => {
    expect(at('Essen ist wichtig.', 'Essen').matches.length).toBeGreaterThan(0);
    expect(at('Wir essen um sieben.', 'essen').matches[0]?.entry.pos).toBe('verb');
  });
});

describe('text helpers', () => {
  it('tokenizes with offsets', () => {
    expect(tokenizeGerman('Wie geht’s, Frau Müller-Lüdenscheidt?').map((t) => t.word)).toEqual(['Wie', 'geht’s', 'Frau', 'Müller-Lüdenscheidt']);
    expect(tokenizeGerman('Am Ende')[1]).toEqual({ word: 'Ende', start: 3, end: 7 });
  });

  it('cuts the sentence around a word', () => {
    const t = 'Hallo! Am Wochenende schlafe ich lange. Und du?';
    expect(sentenceAt(t, t.indexOf('schlafe'))).toBe('Am Wochenende schlafe ich lange.');
  });

  it('guesses the language of card text', () => {
    expect(guessLanguage('Am Wochenende schlafe ich lange.')).toBe('de');
    expect(guessLanguage('On the weekend I sleep in.')).toBe('en');
    expect(guessLanguage('Wochenende')).toBeNull();
    expect(guessLanguage('Mädchen')).toBe('de');
  });
});

describe('AI answers', () => {
  it('become index entries', () => {
    const e = entryFromAi('Quanten', { found: true, lemma: 'das Quant', pos: 'noun', gender: 'das', plural: 'Quanten', english: 'quantum' })!;
    expect(e).toMatchObject({ lemma: 'Quant', gender: 'das', pos: 'noun', source: 'ai' });
    const idx = new WordIndex();
    idx.add(e);
    expect(idx.lookup('Quanten')[0]?.entry.lemma).toBe('Quant');
    expect(entryFromAi('xyz', { found: false })).toBeNull();
  });
});
