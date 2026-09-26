import type { Gender } from '../types';

export interface GenderRule {
  id: string;
  label: string;
  gender: Exclude<Gender, 'pl'>;
  reliability: 'always' | 'mostly' | 'often';
  test: (word: string) => boolean;
  examples: string[];
  exceptions?: string[];
  note?: string;
}

const ends = (...suffixes: string[]) => (w: string) => {
  const l = w.toLowerCase();
  return suffixes.some((s) => l.endsWith(s) && l.length > s.length + 1);
};
const inList = (list: string[]) => {
  const set = new Set(list.map((x) => x.toLowerCase()));
  return (w: string) => set.has(w.toLowerCase());
};

const DAYS_MONTHS_SEASONS = [
  'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonnabend', 'Sonntag',
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
  'November', 'Dezember', 'Frühling', 'Sommer', 'Herbst', 'Winter', 'Norden', 'Süden', 'Osten', 'Westen',
];

/** Ordered from most to least specific. */
export const GENDER_RULES: GenderRule[] = [
  { id: 'time', label: 'days, months, seasons, directions', gender: 'der', reliability: 'always', test: inList(DAYS_MONTHS_SEASONS), examples: ['der Montag', 'der Mai', 'der Winter'] },
  { id: 'chen', label: '-chen (diminutive)', gender: 'das', reliability: 'always', test: (w) => ends('chen')(w) && !/^(kuchen|rachen|drachen|knochen)$/i.test(w), examples: ['das Mädchen', 'das Brötchen', 'das Häuschen'], exceptions: ['der Kuchen', 'der Knochen'], note: 'Diminutives are always neuter — even das Mädchen.' },
  { id: 'lein', label: '-lein (diminutive)', gender: 'das', reliability: 'always', test: ends('lein'), examples: ['das Fräulein', 'das Büchlein'] },
  { id: 'ung', label: '-ung', gender: 'die', reliability: 'always', test: (w) => ends('ung')(w) && !/^(sprung|schwung|dung)$/i.test(w), examples: ['die Zeitung', 'die Wohnung', 'die Meinung'], exceptions: ['der Sprung', 'der Schwung'] },
  { id: 'heit', label: '-heit', gender: 'die', reliability: 'always', test: ends('heit'), examples: ['die Freiheit', 'die Gesundheit'] },
  { id: 'keit', label: '-keit', gender: 'die', reliability: 'always', test: ends('keit'), examples: ['die Möglichkeit', 'die Freundlichkeit'] },
  { id: 'schaft', label: '-schaft', gender: 'die', reliability: 'always', test: ends('schaft'), examples: ['die Freundschaft', 'die Mannschaft'] },
  { id: 'taet', label: '-tät', gender: 'die', reliability: 'always', test: ends('tät'), examples: ['die Universität', 'die Qualität'] },
  { id: 'ion', label: '-ion', gender: 'die', reliability: 'mostly', test: (w) => ends('ion')(w) && !/^(stadion|spion|skorpion)$/i.test(w), examples: ['die Nation', 'die Information'], exceptions: ['das Stadion', 'der Spion'] },
  { id: 'enz', label: '-enz / -anz', gender: 'die', reliability: 'mostly', test: (w) => ends('enz')(w) || (ends('anz')(w) && w.length > 5 && !/schwanz$/i.test(w)), examples: ['die Konferenz', 'die Distanz'], exceptions: ['der Tanz', 'der Schwanz'] },
  { id: 'female', label: '-in (female person)', gender: 'die', reliability: 'mostly', test: (w) => /[^e]in$/i.test(w) && w.length > 5 && !/^(termin|benzin|kamin|vitamin|delfin|delphin|magazin|pinguin|rosmarin|protein|koffein|harlekin|baldrian)$/i.test(w), examples: ['die Lehrerin', 'die Freundin', 'die Ärztin'], exceptions: ['der Termin', 'das Benzin', 'das Magazin'] },
  { id: 'ik', label: '-ik', gender: 'die', reliability: 'mostly', test: (w) => ends('ik')(w) && !/^(katholik|pazifik|mosaik)$/i.test(w), examples: ['die Musik', 'die Politik', 'die Technik'], exceptions: ['der Katholik', 'das Mosaik'] },
  { id: 'ie', label: '-ie', gender: 'die', reliability: 'mostly', test: (w) => ends('ie')(w) && !/^(genie|knie)$/i.test(w), examples: ['die Familie', 'die Biologie'], exceptions: ['das Genie', 'das Knie'] },
  { id: 'ei', label: '-ei', gender: 'die', reliability: 'mostly', test: (w) => ends('ei')(w) && !/^(blei|brei|papagei|schrei)$/i.test(w), examples: ['die Bäckerei', 'die Polizei'], exceptions: ['das Ei', 'der Brei', 'der Papagei'] },
  { id: 'ur', label: '-ur', gender: 'die', reliability: 'mostly', test: (w) => ends('ur')(w) && !/^(abitur|flur|schwur|purpur)$/i.test(w), examples: ['die Natur', 'die Kultur', 'die Temperatur'], exceptions: ['das Abitur', 'der Flur'] },
  { id: 'ment', label: '-ment', gender: 'das', reliability: 'mostly', test: (w) => ends('ment')(w) && !/^(zement|moment)$/i.test(w), examples: ['das Dokument', 'das Instrument', 'das Parlament'], exceptions: ['der Moment', 'der Zement'] },
  { id: 'tum', label: '-tum', gender: 'das', reliability: 'mostly', test: (w) => ends('tum')(w) && !/^(irrtum|reichtum)$/i.test(w), examples: ['das Eigentum', 'das Wachstum'], exceptions: ['der Irrtum', 'der Reichtum'] },
  { id: 'um', label: '-um (Latin)', gender: 'das', reliability: 'mostly', test: (w) => /[^a]um$/i.test(w) && w.length > 4 && !/^(konsum|irrtum|reichtum|rum)$/i.test(w), examples: ['das Museum', 'das Zentrum', 'das Studium'], exceptions: ['der Konsum', 'der Irrtum'] },
  { id: 'ma', label: '-ma', gender: 'das', reliability: 'mostly', test: (w) => ends('ma')(w) && !/^(firma|oma|mama|puma)$/i.test(w), examples: ['das Thema', 'das Klima', 'das Drama'], exceptions: ['die Firma', 'die Oma'] },
  { id: 'ett', label: '-ett', gender: 'das', reliability: 'mostly', test: ends('ett'), examples: ['das Bett', 'das Ballett', 'das Tablett'] },
  { id: 'ling', label: '-ling', gender: 'der', reliability: 'always', test: ends('ling'), examples: ['der Frühling', 'der Schmetterling', 'der Lehrling'] },
  { id: 'ismus', label: '-ismus', gender: 'der', reliability: 'always', test: ends('ismus'), examples: ['der Tourismus', 'der Journalismus'] },
  { id: 'ist', label: '-ist (person)', gender: 'der', reliability: 'mostly', test: (w) => ends('ist')(w) && !/^(frist|list|mist)$/i.test(w), examples: ['der Tourist', 'der Polizist'], exceptions: ['die Frist', 'die List'] },
  { id: 'or', label: '-or', gender: 'der', reliability: 'mostly', test: (w) => ends('or')(w) && !/^(labor|chlor|tor)$/i.test(w), examples: ['der Motor', 'der Doktor', 'der Autor'], exceptions: ['das Tor', 'das Labor'] },
  { id: 'ig', label: '-ig', gender: 'der', reliability: 'mostly', test: ends('ig'), examples: ['der Honig', 'der König', 'der Essig'] },
  { id: 'nis', label: '-nis', gender: 'das', reliability: 'often', test: ends('nis'), examples: ['das Ergebnis', 'das Zeugnis', 'das Erlebnis'], exceptions: ['die Erlaubnis', 'die Kenntnis', 'die Wildnis'] },
  { id: 'o', label: '-o', gender: 'das', reliability: 'often', test: (w) => ends('o')(w) && !/^(euro|zoo|kakao|tango|espresso|cappuccino)$/i.test(w), examples: ['das Auto', 'das Kino', 'das Büro'], exceptions: ['der Euro', 'der Zoo', 'der Kakao'] },
  { id: 'ge', label: 'Ge- (collective)', gender: 'das', reliability: 'often', test: (w) => /^ge[bdfhlmrstw]/i.test(w) && w.length > 5 && !/^ge(schmack|danke|schichte|fahr|winn|duld|burtstag|meinde|stalt|walt|werkschaft|schwindigkeit|legenheit|brauch|ruch|halt|genstand|genwart|sellschaft|sundheit|bühr)/i.test(w), examples: ['das Gebäude', 'das Gemüse', 'das Gespräch', 'das Getränk'], exceptions: ['der Geschmack', 'die Geschichte', 'die Gefahr'] },
  { id: 'e', label: '-e', gender: 'die', reliability: 'often', test: (w) => ends('e')(w) && !/(ee|ie)$/i.test(w) && !/^(name|käse|junge|kunde|affe|löwe|hase|franzose|kollege|gedanke|glaube|buchstabe|friede|funke|wille|same|haufe|auge|ende|interesse|erbe|gebirge|gebäude|gemüse|getreide|image|finale|prestige)$/i.test(w), examples: ['die Lampe', 'die Straße', 'die Tasche'], exceptions: ['der Name', 'der Käse', 'der Junge', 'das Auge', 'das Ende'], note: '~90% of nouns ending in -e are feminine.' },
  { id: 'er', label: '-er (person/tool)', gender: 'der', reliability: 'often', test: (w) => ends('er')(w) && !/(ei|ie)er$/i.test(w), examples: ['der Lehrer', 'der Computer', 'der Fahrer'], exceptions: ['die Mutter', 'die Butter', 'das Fenster', 'das Zimmer', 'das Wasser'] },
];

export interface GenderHint {
  rule: GenderRule;
  gender: Exclude<Gender, 'pl'>;
}

/** Suffix-based hints for a noun (without article). First = most specific. */
export function genderHints(word: string): GenderHint[] {
  const w = word.trim().replace(/^(der|die|das)\s+/i, '');
  if (!w) return [];
  // Only look at the last part of compounds: "Haustür" → rules run on the whole word,
  // which works because suffixes decide gender (the last noun wins).
  return GENDER_RULES.filter((r) => r.test(w)).map((r) => ({ rule: r, gender: r.gender }));
}

/** Best-effort gender guess, or null if no reliable rule applies. */
export function guessGender(word: string): Exclude<Gender, 'pl'> | null {
  return genderHints(word)[0]?.gender ?? null;
}

/** Explain why a noun has its gender, if a rule matches it (used after a wrong answer). */
export function explainGender(word: string, actual: Gender): string | null {
  const hints = genderHints(word);
  const match = hints.find((h) => h.gender === actual);
  if (match) {
    const r = match.rule;
    const how = r.reliability === 'always' ? 'are always' : r.reliability === 'mostly' ? 'are almost always' : 'are usually';
    return `Nouns ending in ${r.label} ${how} ${r.gender}: ${r.examples.slice(0, 2).join(', ')}.`;
  }
  const contradicting = hints[0];
  if (contradicting && actual !== 'pl') {
    return `Exception! ${contradicting.rule.label} usually means ${contradicting.gender}, but it's ${actual} ${word}.`;
  }
  return null;
}
