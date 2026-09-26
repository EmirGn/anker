import type { Gender } from '../types';

export type Case = 'nom' | 'akk' | 'dat' | 'gen';
export const CASES: Case[] = ['nom', 'akk', 'dat', 'gen'];
export const CASE_NAME: Record<Case, string> = { nom: 'Nominativ', akk: 'Akkusativ', dat: 'Dativ', gen: 'Genitiv' };
export const CASE_QUESTION: Record<Case, string> = { nom: 'Wer? Was?', akk: 'Wen? Was?', dat: 'Wem?', gen: 'Wessen?' };

export const DEFINITE: Record<Case, Record<Gender, string>> = {
  nom: { der: 'der', die: 'die', das: 'das', pl: 'die' },
  akk: { der: 'den', die: 'die', das: 'das', pl: 'die' },
  dat: { der: 'dem', die: 'der', das: 'dem', pl: 'den' },
  gen: { der: 'des', die: 'der', das: 'des', pl: 'der' },
};

export const INDEFINITE: Record<Case, Record<Gender, string>> = {
  nom: { der: 'ein', die: 'eine', das: 'ein', pl: '—' },
  akk: { der: 'einen', die: 'eine', das: 'ein', pl: '—' },
  dat: { der: 'einem', die: 'einer', das: 'einem', pl: '—' },
  gen: { der: 'eines', die: 'einer', das: 'eines', pl: '—' },
};

export const NEGATIVE: Record<Case, Record<Gender, string>> = {
  nom: { der: 'kein', die: 'keine', das: 'kein', pl: 'keine' },
  akk: { der: 'keinen', die: 'keine', das: 'kein', pl: 'keine' },
  dat: { der: 'keinem', die: 'keiner', das: 'keinem', pl: 'keinen' },
  gen: { der: 'keines', die: 'keiner', das: 'keines', pl: 'keiner' },
};

export type PrepCase = 'akk' | 'dat' | 'gen' | 'wechsel';

export interface Preposition {
  word: string;
  case: PrepCase;
  meaning: string;
  example: string;
}

export const PREPOSITIONS: Preposition[] = [
  { word: 'durch', case: 'akk', meaning: 'through', example: 'Wir gehen durch den Park.' },
  { word: 'für', case: 'akk', meaning: 'for', example: 'Das Geschenk ist für den Vater.' },
  { word: 'gegen', case: 'akk', meaning: 'against', example: 'Er lehnt das Fahrrad gegen die Wand.' },
  { word: 'ohne', case: 'akk', meaning: 'without', example: 'Sie fährt ohne ihren Mann in den Urlaub.' },
  { word: 'um', case: 'akk', meaning: 'around; at (time)', example: 'Wir sitzen um den Tisch.' },
  { word: 'aus', case: 'dat', meaning: 'out of, from', example: 'Er kommt aus dem Haus.' },
  { word: 'außer', case: 'dat', meaning: 'except, besides', example: 'Alle außer dem Chef sind da.' },
  { word: 'bei', case: 'dat', meaning: 'at, near, at the home of', example: 'Ich wohne bei meiner Tante.' },
  { word: 'mit', case: 'dat', meaning: 'with, by (transport)', example: 'Ich fahre mit dem Bus.' },
  { word: 'nach', case: 'dat', meaning: 'after; to (cities, countries)', example: 'Nach dem Essen gehen wir spazieren.' },
  { word: 'seit', case: 'dat', meaning: 'since, for (time)', example: 'Seit einem Jahr lerne ich Deutsch.' },
  { word: 'von', case: 'dat', meaning: 'from, of, by', example: 'Das ist ein Brief von der Bank.' },
  { word: 'zu', case: 'dat', meaning: 'to (people, places)', example: 'Ich gehe zum Arzt.' },
  { word: 'gegenüber', case: 'dat', meaning: 'opposite, across from', example: 'Die Bank ist gegenüber dem Bahnhof.' },
  { word: 'an', case: 'wechsel', meaning: 'at, on (vertical surfaces)', example: 'Das Bild hängt an der Wand. → Ich hänge das Bild an die Wand.' },
  { word: 'auf', case: 'wechsel', meaning: 'on (horizontal surfaces)', example: 'Das Buch liegt auf dem Tisch. → Ich lege das Buch auf den Tisch.' },
  { word: 'hinter', case: 'wechsel', meaning: 'behind', example: 'Der Garten ist hinter dem Haus.' },
  { word: 'in', case: 'wechsel', meaning: 'in, into', example: 'Ich bin in der Küche. → Ich gehe in die Küche.' },
  { word: 'neben', case: 'wechsel', meaning: 'next to', example: 'Die Lampe steht neben dem Sofa.' },
  { word: 'über', case: 'wechsel', meaning: 'over, above', example: 'Die Lampe hängt über dem Tisch.' },
  { word: 'unter', case: 'wechsel', meaning: 'under', example: 'Die Katze schläft unter dem Bett.' },
  { word: 'vor', case: 'wechsel', meaning: 'in front of; before; ago', example: 'Das Auto steht vor dem Haus.' },
  { word: 'zwischen', case: 'wechsel', meaning: 'between', example: 'Die Apotheke liegt zwischen der Bank und der Post.' },
  { word: 'wegen', case: 'gen', meaning: 'because of', example: 'Wegen des Wetters bleiben wir zu Hause.' },
  { word: 'trotz', case: 'gen', meaning: 'despite', example: 'Trotz des Regens gehen wir spazieren.' },
  { word: 'während', case: 'gen', meaning: 'during', example: 'Während des Films ist er eingeschlafen.' },
  { word: '(an)statt', case: 'gen', meaning: 'instead of', example: 'Statt eines Autos kauft sie ein Fahrrad.' },
  { word: 'innerhalb', case: 'gen', meaning: 'within, inside', example: 'Innerhalb einer Woche war alles fertig.' },
  { word: 'außerhalb', case: 'gen', meaning: 'outside of', example: 'Außerhalb der Stadt ist es ruhig.' },
];

export const CONTRACTIONS: Record<string, string> = {
  'an dem': 'am',
  'an das': 'ans',
  'bei dem': 'beim',
  'in dem': 'im',
  'in das': 'ins',
  'von dem': 'vom',
  'zu dem': 'zum',
  'zu der': 'zur',
};

export const PERSONAL_PRONOUNS: { person: string; nom: string; akk: string; dat: string }[] = [
  { person: '1. Sg.', nom: 'ich', akk: 'mich', dat: 'mir' },
  { person: '2. Sg.', nom: 'du', akk: 'dich', dat: 'dir' },
  { person: '3. Sg. m', nom: 'er', akk: 'ihn', dat: 'ihm' },
  { person: '3. Sg. f', nom: 'sie', akk: 'sie', dat: 'ihr' },
  { person: '3. Sg. n', nom: 'es', akk: 'es', dat: 'ihm' },
  { person: '1. Pl.', nom: 'wir', akk: 'uns', dat: 'uns' },
  { person: '2. Pl.', nom: 'ihr', akk: 'euch', dat: 'euch' },
  { person: '3. Pl.', nom: 'sie', akk: 'sie', dat: 'ihnen' },
  { person: 'formal', nom: 'Sie', akk: 'Sie', dat: 'Ihnen' },
];

/** Adjective endings after definite articles (weak declension). */
export const ADJ_WEAK: Record<Case, Record<Gender, string>> = {
  nom: { der: '-e', die: '-e', das: '-e', pl: '-en' },
  akk: { der: '-en', die: '-e', das: '-e', pl: '-en' },
  dat: { der: '-en', die: '-en', das: '-en', pl: '-en' },
  gen: { der: '-en', die: '-en', das: '-en', pl: '-en' },
};
/** After ein/kein/mein (mixed declension). */
export const ADJ_MIXED: Record<Case, Record<Gender, string>> = {
  nom: { der: '-er', die: '-e', das: '-es', pl: '-en' },
  akk: { der: '-en', die: '-e', das: '-es', pl: '-en' },
  dat: { der: '-en', die: '-en', das: '-en', pl: '-en' },
  gen: { der: '-en', die: '-en', das: '-en', pl: '-en' },
};
/** No article (strong declension). */
export const ADJ_STRONG: Record<Case, Record<Gender, string>> = {
  nom: { der: '-er', die: '-e', das: '-es', pl: '-e' },
  akk: { der: '-en', die: '-e', das: '-es', pl: '-e' },
  dat: { der: '-em', die: '-er', das: '-em', pl: '-en' },
  gen: { der: '-en', die: '-er', das: '-en', pl: '-er' },
};
