import { describe, expect, it } from 'vitest';
import {
  explainGender,
  formalTime,
  guessGender,
  informalTime,
  normalizeWordFields,
  numberToGerman,
  parseVerbForms,
  splitArticle,
  yearToGerman,
} from '../src/index';

describe('numbers', () => {
  it.each([
    [0, 'null'],
    [1, 'eins'],
    [16, 'sechzehn'],
    [17, 'siebzehn'],
    [21, 'einundzwanzig'],
    [30, 'dreißig'],
    [99, 'neunundneunzig'],
    [100, 'einhundert'],
    [101, 'einhunderteins'],
    [347, 'dreihundertsiebenundvierzig'],
    [1000, 'eintausend'],
    [2024, 'zweitausendvierundzwanzig'],
    [21_000, 'einundzwanzigtausend'],
    [101_000, 'einhunderteintausend'],
    [1_000_000, 'eine Million'],
    [2_500_000, 'zwei Millionen fünfhunderttausend'],
  ])('%i → %s', (n, s) => expect(numberToGerman(n)).toBe(s));

  it('reads years in hundreds', () => {
    expect(yearToGerman(1984)).toBe('neunzehnhundertvierundachtzig');
    expect(yearToGerman(1900)).toBe('neunzehnhundert');
    expect(yearToGerman(2009)).toBe('zweitausendneun');
  });
});

describe('clock', () => {
  it.each([
    [7, 30, 'halb acht'],
    [3, 15, 'Viertel nach drei'],
    [14, 45, 'Viertel vor drei'],
    [12, 30, 'halb eins'],
    [0, 0, 'zwölf Uhr'],
    [13, 0, 'ein Uhr'],
    [9, 25, 'fünf vor halb zehn'],
    [9, 35, 'fünf nach halb zehn'],
    [11, 55, 'fünf vor zwölf'],
  ])('%i:%i → %s', (h, m, s) => expect(informalTime(h, m)).toBe(s));

  it('formal time', () => {
    expect(formalTime(13, 5)).toBe('dreizehn Uhr fünf');
    expect(formalTime(1, 0)).toBe('ein Uhr');
  });
});

describe('articles & gender', () => {
  it('splits articles', () => {
    expect(splitArticle('der Tisch')).toEqual({ gender: 'der', word: 'Tisch' });
    expect(splitArticle('Tisch')).toEqual({ gender: null, word: 'Tisch' });
  });

  it('normalizes word fields', () => {
    const f = normalizeWordFields({ german: 'die Zeitung', english: 'newspaper', plural: 'die Zeitungen' });
    expect(f).toMatchObject({ german: 'Zeitung', gender: 'die', pos: 'noun', plural: 'Zeitungen' });
  });

  it.each([
    ['Zeitung', 'die'],
    ['Mädchen', 'das'],
    ['Frühling', 'der'],
    ['Universität', 'die'],
    ['Museum', 'das'],
    ['Lehrerin', 'die'],
    ['Montag', 'der'],
    ['Tourismus', 'der'],
  ])('guesses %s → %s', (w, g) => expect(guessGender(w)).toBe(g));

  it('explains exceptions', () => {
    expect(explainGender('Zeitung', 'die')).toMatch(/-ung/);
    expect(explainGender('Käse', 'der')).toBeNull();
  });
});

describe('verb forms', () => {
  it('parses Stammformen', () => {
    expect(parseVerbForms('fährt · fuhr · ist gefahren')).toEqual({
      present3: 'fährt',
      preterite: 'fuhr',
      perfect: 'ist gefahren',
      aux: 'sein',
      participle: 'gefahren',
    });
    expect(parseVerbForms('macht, machte, hat gemacht').aux).toBe('haben');
  });
});
