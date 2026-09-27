// Labels for things the shared core describes in English (the core text also
// feeds the MCP server, so it stays as it is): German versions for the German
// UI, the core's own English otherwise.
import { explainGender, genderHints, NOTE_TYPES, type Gender, type GenderRule, type NoteType } from '@anker/core';
import { lang } from './i18n';

const DE = lang === 'de';

type TypeLabels = Record<NoteType, { short: string; description: string; templates: string[] }>;

const TYPES_GERMAN: TypeLabels = {
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

/** Note type labels in the UI language. */
export const TYPE_DE: TypeLabels = DE
  ? TYPES_GERMAN
  : (Object.fromEntries(
      Object.entries(NOTE_TYPES).map(([k, t]) => [k, { short: t.short, description: t.description, templates: t.templates }]),
    ) as TypeLabels);

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
  if (!DE) {
    const f = NOTE_TYPES[type]?.fields.find((x) => x.key === key);
    return { label: f?.label ?? key, help: f?.help };
  }
  return FIELD_DE[`${type}.${key}`] ?? FIELD_DE[key] ?? { label: key };
}

export function templateDe(type: NoteType, ord: number): string {
  return TYPE_DE[type].templates[ord] ?? (DE ? `Karte ${ord + 1}` : `Card ${ord + 1}`);
}

/** validateNote()'s messages in the UI language. */
export function fehlerDe(type: NoteType, msg: string): string {
  if (!DE) return msg;
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

export const ruleLabel = (r: GenderRule) => (DE ? RULE_DE[r.id]?.label ?? r.label : r.label);
export const ruleNote = (r: GenderRule) => (DE ? RULE_DE[r.id]?.note ?? null : r.note ?? null);
export const HOW_DE: Record<GenderRule['reliability'], string> = DE
  ? { always: 'immer', mostly: 'fast immer', often: 'meistens' }
  : { always: 'always', mostly: 'almost always', often: 'often' };

function ruleSubject(r: GenderRule) {
  const l = ruleLabel(r);
  return l.startsWith('-') || /^[A-ZÄÖÜ][a-zäöü]*-/.test(l) ? `Nomen auf ${l.replace(/ \(.*\)$/, '')}` : l;
}

/** Why a noun has its gender (or why it's an exception), in the UI language. */
export function erklaereGenus(word: string, actual: Gender): string | null {
  if (!DE) return explainGender(word, actual);
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

const STARTER_DE: Record<string, string> = {
  a1: 'Die wichtigsten Wörter: Nomen mit Artikel und Plural, Verben mit Formen, Adjektive und kleine Wörter – jeweils mit Beispiel.',
  verben: 'fahren · fuhr · ist gefahren – die Verben, deren Vergangenheit man einfach kennen muss.',
  faelle: 'Lückentexte zu dem/den/der, Wo?/Wohin?, Kurzformen und Verbstellung.',
  redemittel: 'Wendungen für den Alltag und ein paar beliebte Redewendungen („Ich verstehe nur Bahnhof“).',
};

/** Starter deck description in the UI language. */
export const starterDesc = (key: string, english: string) => (DE ? STARTER_DE[key] ?? english : english);
