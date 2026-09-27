// German UI labels for things the shared core describes in English (the core
// text also feeds the MCP server, so it stays as it is).
import { genderHints, NOTE_TYPES, type Gender, type GenderRule, type NoteType } from '@anker/core';

export const TYPE_DE: Record<NoteType, { short: string; description: string; templates: string[] }> = {
  word: {
    short: 'Wort',
    description: 'Ein deutsches Wort mit Genus, Plural, Formen und Beispielsatz. Ergibt Karten DE → EN und EN → DE.',
    templates: ['Deutsch → Bedeutung', 'Bedeutung → Deutsch'],
  },
  basic: { short: 'Einfach', description: 'Vorder- und Rückseite. Eine Karte.', templates: ['Vorderseite → Rückseite'] },
  reversed: {
    short: 'Beidseitig',
    description: 'Vorder- und Rückseite, in beide Richtungen abgefragt. Zwei Karten.',
    templates: ['Vorderseite → Rückseite', 'Rückseite → Vorderseite'],
  },
  typing: {
    short: 'Tippen',
    description: 'Du tippst die Antwort und siehst Buchstabe für Buchstabe, was stimmt. Gut für Rechtschreibung und Endungen.',
    templates: ['Antwort tippen'],
  },
  cloze: { short: 'Lückentext', description: 'Sätze mit Lücken: „Ich gehe {{c1::in die}} Stadt.“ Eine Karte pro Lückennummer.', templates: ['Lückentext'] },
};

const FIELD_DE: Record<string, { label: string; help?: string }> = {
  german: { label: 'Deutsch' },
  english: { label: 'Bedeutung' },
  pos: { label: 'Wortart' },
  gender: { label: 'Genus' },
  plural: { label: 'Plural' },
  forms: { label: 'Formen', help: 'Verben: er-Form · Präteritum · Perfekt. Adjektive: Komparativ · Superlativ.' },
  example: { label: 'Beispielsatz' },
  exampleTranslation: { label: 'Übersetzung' },
  notes: { label: 'Notizen' },
  front: { label: 'Vorderseite' },
  back: { label: 'Rückseite' },
  extra: { label: 'Extra' },
  text: { label: 'Text', help: 'Versteckte Teile in {{c1::…}} setzen, ein Hinweis geht mit {{c1::Antwort::Hinweis}}.' },
  'typing.front': { label: 'Frage' },
  'typing.back': { label: 'Antwort (getippt)' },
  'cloze.extra': { label: 'Extra / Übersetzung' },
};

export function fieldDe(type: NoteType, key: string): { label: string; help?: string } {
  return FIELD_DE[`${type}.${key}`] ?? FIELD_DE[key] ?? { label: key };
}

export function templateDe(type: NoteType, ord: number): string {
  return TYPE_DE[type].templates[ord] ?? `Karte ${ord + 1}`;
}

/** German version of validateNote()'s messages. */
export function fehlerDe(type: NoteType, msg: string): string {
  const req = /^"(.+)" is required$/.exec(msg);
  if (req) {
    const f = NOTE_TYPES[type]?.fields.find((x) => x.label === req[1]);
    return `„${f ? fieldDe(type, f.key).label : req[1]}“ fehlt noch.`;
  }
  if (msg.startsWith('Cloze text needs')) return 'Der Lückentext braucht mindestens eine Lücke wie {{c1::Wort}}.';
  return msg;
}

const RULE_DE: Record<string, { label: string; note?: string }> = {
  time: { label: 'Tage, Monate, Jahreszeiten, Himmelsrichtungen' },
  chen: { label: '-chen (Verkleinerung)', note: 'Verkleinerungen sind immer neutrum – sogar das Mädchen.' },
  lein: { label: '-lein (Verkleinerung)' },
  female: { label: '-in (weibliche Person)' },
  um: { label: '-um (lateinisch)' },
  ist: { label: '-ist (Person)' },
  ge: { label: 'Ge- (Sammelbegriff)' },
  e: { label: '-e', note: 'Etwa 90 % der Nomen auf -e sind feminin.' },
  er: { label: '-er (Person oder Gerät)' },
};

export const ruleLabel = (r: GenderRule) => RULE_DE[r.id]?.label ?? r.label;
export const ruleNote = (r: GenderRule) => RULE_DE[r.id]?.note ?? null;
export const HOW_DE: Record<GenderRule['reliability'], string> = { always: 'immer', mostly: 'fast immer', often: 'meistens' };

function ruleSubject(r: GenderRule) {
  const l = ruleLabel(r);
  return l.startsWith('-') || /^[A-ZÄÖÜ][a-zäöü]*-/.test(l) ? `Nomen auf ${l.replace(/ \(.*\)$/, '')}` : l;
}

/** German version of explainGender(): why a noun has its gender (or why it's an exception). */
export function erklaereGenus(word: string, actual: Gender): string | null {
  const hints = genderHints(word);
  const match = hints.find((h) => h.gender === actual);
  if (match) {
    const r = match.rule;
    return `${ruleSubject(r)} sind ${HOW_DE[r.reliability]} ${r.gender}: ${r.examples.slice(0, 2).join(', ')}.`;
  }
  const c = hints[0];
  if (c && actual !== 'pl') return `Ausnahme: ${ruleLabel(c.rule)} heißt meistens ${c.gender}, aber es heißt ${actual} ${word}.`;
  return null;
}

/** German descriptions of the starter decks (by STARTER_DECKS key). */
export const STARTER_DE: Record<string, string> = {
  a1: 'Die wichtigsten Wörter: Nomen mit Artikel und Plural, Verben mit Formen, Adjektive und kleine Wörter – jeweils mit Beispiel.',
  verben: 'fahren · fuhr · ist gefahren – die Verben, deren Vergangenheit man einfach kennen muss.',
  faelle: 'Lückentexte zu dem/den/der, Wo?/Wohin?, Kurzformen und Verbstellung.',
  redemittel: 'Wendungen für den Alltag und ein paar beliebte Redewendungen („Ich verstehe nur Bahnhof“).',
};
