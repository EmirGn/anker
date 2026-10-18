// Tap-a-word lookup: an index of dictionary entries (the learner's own word
// notes, the built-in word lists, a table of little words, and cached AI
// answers) that resolves inflected forms in context.
import { STARTER_DECKS } from '../content/index';
import { plainText } from '../text';
import type { Gender, Note, PartOfSpeech } from '../types';
import { parseGender, parsePos, withArticle } from './articles';
import { PREPOSITIONS } from './grammar';
import {
  CLAUSE_BREAK,
  expandPlural,
  isSeparableParticle,
  lemmaCandidates,
  separablePrefix,
  tokenizeGerman,
  type CandidatePos,
} from './lemma';
import { parseVerbForms } from './verbs';

export type DictSource = 'note' | 'builtin' | 'ai';

export interface DictEntry {
  /** Stable id (note id, "bi:…" for built-ins, "ai:…" for AI answers) */
  id: string;
  /** Headword as written in the note: "Wochenende", "schlafen", "sich gewöhnen an" */
  lemma: string;
  pos: PartOfSpeech | '';
  gender: Gender | '';
  plural: string;
  forms: string;
  english: string;
  source: DictSource;
  noteId?: string;
  deckId?: string;
  /** Article, pronoun, conjunction … (not worth a flashcard of its own) */
  functionWord?: boolean;
}

export interface WordMatch {
  entry: DictEntry;
  /** The word as it appeared in the text */
  surface: string;
  /** How it was found: "lemma", "plural", "present", "-e", "participle" … */
  how: string;
  score: number;
  /** Separable particle that was joined from the end of the clause ("auf" for "stehe … auf") */
  particle?: string;
}

interface Hit {
  entry: DictEntry;
  how: string;
  /** This form only counts when the clause ends with this particle (steht … auf). */
  particle?: string;
}

const ADJ_ENDINGS = ['e', 'en', 'em', 'er', 'es'];
const TRAILING_PREPOSITIONS = new Set(['an', 'auf', 'aus', 'bei', 'für', 'gegen', 'in', 'mit', 'nach', 'über', 'um', 'unter', 'von', 'vor', 'zu']);

/** Lower-case lookup key of a headword: no article, no "sich", no trailing preposition. */
export function headwordKey(lemma: string, pos: string = ''): string {
  let w = plainText(lemma).trim().toLowerCase().replace(/\s+/g, ' ');
  w = w.replace(/^(der|die|das)\s+/, '').replace(/^sich\s+/, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const parts = w.split(' ');
  if (parts.length === 2 && (pos === 'verb' || pos === '') && TRAILING_PREPOSITIONS.has(parts[1]!)) w = parts[0]!;
  // "etw. machen", "jdm. helfen"
  w = w.replace(/^(etw|jdm|jdn|jmd|jmdm|jmdn)\.?\s+/, '');
  return w;
}

/** Display form of an entry: "das Wochenende", "schlafen". */
export function entryHeadword(e: Pick<DictEntry, 'lemma' | 'gender'>): string {
  return withArticle(e.lemma, e.gender);
}

export class WordIndex {
  private forms = new Map<string, Hit[]>();
  private ids = new Set<string>();
  size = 0;

  has(id: string): boolean {
    return this.ids.has(id);
  }

  private put(form: string, hit: Hit) {
    const key = form.toLowerCase().trim();
    if (!key || key.includes(' ')) return;
    const list = this.forms.get(key);
    if (!list) this.forms.set(key, [hit]);
    else if (!list.some((h) => h.entry === hit.entry && h.particle === hit.particle)) list.push(hit);
  }

  add(entry: DictEntry) {
    if (this.ids.has(entry.id)) return;
    this.ids.add(entry.id);
    this.size++;
    const head = headwordKey(entry.lemma, entry.pos);
    if (!head) return;
    this.put(head, { entry, how: 'lemma' });

    const isNoun = entry.pos === 'noun' || !!entry.gender;
    if (isNoun) {
      const pl = expandPlural(entry.lemma.replace(/^(der|die|das)\s+/i, ''), entry.plural);
      if (pl) {
        this.put(pl, { entry, how: 'plural' });
        if (!/[ns]$/i.test(pl)) this.put(`${pl}n`, { entry, how: 'plural' }); // dative plural: den Häusern
      }
    }

    if (entry.pos === 'verb') {
      // aufstehen → "stehen" when the clause ends with "auf"
      const p = separablePrefix(head);
      if (p) this.put(head.slice(p.length), { entry, how: 'lemma', particle: p });
      const f = parseVerbForms(entry.forms);
      const split = (s: string | undefined) => {
        const words = (s ?? '').toLowerCase().split(/\s+/).filter((x) => x && x !== 'sich');
        const verb = words[0];
        const rest = words.slice(1).filter((x) => !TRAILING_PREPOSITIONS.has(x) || isSeparableParticle(x));
        return { verb, particle: rest.find((x) => isSeparableParticle(x)) ?? (rest.length === 1 ? rest[0] : undefined) ?? p ?? undefined };
      };
      const pres = split(f.present3);
      if (pres.verb) {
        this.put(pres.verb, { entry, how: 'present', particle: pres.particle });
        // er fährt → du fährst
        const base = pres.verb.endsWith('et') ? pres.verb.slice(0, -2) : pres.verb.endsWith('t') ? pres.verb.slice(0, -1) : null;
        if (base) {
          const du = pres.verb.endsWith('et') ? `${base}est` : /[sßzx]$/.test(base) ? `${base}t` : `${base}st`;
          this.put(du, { entry, how: 'present', particle: pres.particle });
        }
      }
      const pret = split(f.preterite);
      if (pret.verb) {
        const v = pret.verb;
        const more = v.endsWith('e') ? [v, `${v}st`, `${v}n`, `${v}t`] : [v, `${v}st`, `${v}en`, `${v}t`];
        for (const x of more) this.put(x, { entry, how: 'preterite', particle: pret.particle });
      }
      const part = (f.participle ?? '').toLowerCase().replace(/^sich\s+/, '').trim();
      if (part && !part.includes(' ')) {
        this.put(part, { entry, how: 'participle' });
        for (const end of ADJ_ENDINGS) this.put(part + end, { entry, how: 'participle' });
      }
    }

    if (entry.pos === 'adjective' || entry.pos === 'adverb') {
      for (const end of ADJ_ENDINGS) this.put(head + end, { entry, how: 'declined' });
      // "größer · am größten"
      const [comp, sup] = (entry.forms ?? '').split(/\s*[·,;/]\s*/).map((s) => s.trim().toLowerCase());
      if (comp && !comp.includes(' ') && comp !== head) {
        this.put(comp, { entry, how: 'comparative' });
        for (const end of ADJ_ENDINGS) this.put(comp + end, { entry, how: 'comparative' });
      }
      const supWord = sup?.replace(/^am\s+/, '');
      if (supWord && !supWord.includes(' ')) {
        const stem = supWord.replace(/en$/, '');
        for (const end of ADJ_ENDINGS) this.put(stem + end, { entry, how: 'superlative' });
      }
    }

    for (const extra of FORMS_OF.get(entry.id) ?? []) {
      this.put(extra, { entry, how: 'form' });
    }
  }

  addAll(entries: Iterable<DictEntry>) {
    for (const e of entries) this.add(e);
  }

  /** Raw hits for one lower-case form (tests and debugging). */
  hits(form: string): DictEntry[] {
    return (this.forms.get(form.toLowerCase()) ?? []).map((h) => h.entry);
  }

  /**
   * Resolve one word. `ctx.particle` is a separable particle that ends the clause,
   * `capitalized`/`sentenceStart` help tell nouns from verbs (Essen vs essen).
   */
  lookup(word: string, ctx: { particle?: string; sentenceStart?: boolean } = {}): WordMatch[] {
    const capitalized = /^\p{Lu}/u.test(word);
    const midCaps = capitalized && !ctx.sentenceStart;
    const lower = !capitalized;
    const particle = ctx.particle?.toLowerCase();
    const best = new Map<string, WordMatch>();
    const consider = (form: string, pos: CandidatePos, how: string, cost: number, joined?: string) => {
      for (const hit of this.forms.get(form) ?? []) {
        if (hit.particle && hit.particle !== particle) continue;
        if (hit.particle && joined) continue;
        const e = hit.entry;
        const noun = e.pos === 'noun' || !!e.gender;
        if (pos === 'noun' && !noun) continue;
        if (pos === 'verb' && e.pos !== 'verb' && e.pos !== '') continue;
        if (pos === 'adjective' && e.pos !== 'adjective' && e.pos !== 'adverb' && e.pos !== '') continue;
        let score = 100 - cost * 10;
        if (hit.how !== 'lemma') score -= 3;
        if (e.source === 'note') score += 3;
        else if (e.source === 'ai') score += 1;
        if (noun && midCaps) score += 8;
        if (noun && lower) score -= 25;
        if (!noun && midCaps) score -= 12;
        if (hit.particle || joined) score += 6;
        const match: WordMatch = { entry: e, surface: word, how: pos === 'any' ? hit.how : how, score, particle: hit.particle ?? joined };
        // One result per headword: the learner's note beats the built-in copy.
        const key = `${headwordKey(e.lemma, e.pos)}|${noun ? 'noun' : e.pos === 'verb' ? 'verb' : e.pos}`;
        const prev = best.get(key);
        if (!prev || prev.score < score) best.set(key, match);
      }
    };
    for (const c of lemmaCandidates(word)) {
      consider(c.form, c.pos, c.rule, c.cost);
      if (particle && (c.pos === 'verb' || c.pos === 'any')) consider(particle + c.form, c.pos === 'any' ? 'verb' : c.pos, 'separable', c.cost, particle);
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }
}

/**
 * Look up the word at character `offset` of `text`, using the clause around it:
 * a separable particle at the end of the clause joins its verb ("Ich stehe früh auf" →
 * aufstehen), and tapping that particle finds the verb.
 */
export function lookupInText(index: WordIndex, text: string, offset: number): { word: string; matches: WordMatch[] } | null {
  const tokens = tokenizeGerman(text);
  const i = tokens.findIndex((t) => offset >= t.start && offset < t.end);
  if (i < 0) return null;
  const tok = tokens[i]!;
  const between = (a: number, b: number) => text.slice(a, b);
  // Clause boundaries around the token
  let first = i;
  while (first > 0 && !CLAUSE_BREAK.test(between(tokens[first - 1]!.end, tokens[first]!.start))) first--;
  let last = i;
  while (last < tokens.length - 1 && !CLAUSE_BREAK.test(between(tokens[last]!.end, tokens[last + 1]!.start))) last++;
  const sentenceStart = i === 0 || /[.!?:\n"„“]/.test(between(tokens[i - 1]!.end, tok.start));
  const lastWord = tokens[last]!.word;
  const clauseParticle = last !== i && last - first >= 2 && isSeparableParticle(lastWord) ? lastWord : undefined;

  const own = index.lookup(tok.word, { particle: clauseParticle, sentenceStart });
  if (i === last && i - first >= 2 && isSeparableParticle(tok.word)) {
    // Tapped the particle itself: find the verb it belongs to.
    for (let j = first; j < i; j++) {
      const t = tokens[j]!;
      if (/^\p{Lu}/u.test(t.word) && j !== first) continue; // nouns
      const joined = index.lookup(t.word, { particle: tok.word, sentenceStart: j === first }).filter((m) => m.particle && m.entry.pos === 'verb');
      if (joined.length) return { word: tok.word, matches: [...joined.map((m) => ({ ...m, surface: `${t.word} … ${tok.word}` })), ...own] };
    }
  }
  return { word: tok.word, matches: own };
}

// ------------------------------------------------------------------ sources

/** Dictionary entries from the learner's word notes. */
export function entriesFromNotes(notes: Iterable<Pick<Note, 'id' | 'type' | 'fields' | 'deckId'>>): DictEntry[] {
  const out: DictEntry[] = [];
  for (const n of notes) {
    if (n.type !== 'word') continue;
    const f = n.fields;
    const lemma = plainText(f.german ?? '').trim();
    const english = plainText(f.english ?? '').trim();
    if (!lemma || !english) continue;
    const gender = parseGender(f.gender) ?? '';
    out.push({
      id: n.id,
      lemma,
      pos: parsePos(f.pos) || (gender ? 'noun' : ''),
      gender,
      plural: plainText(f.plural ?? '').trim(),
      forms: plainText(f.forms ?? '').trim(),
      english,
      source: 'note',
      noteId: n.id,
      deckId: n.deckId,
    });
  }
  return out;
}

type FnRow = [forms: string, lemma: string, pos: PartOfSpeech, english: string, extra?: string];

// Little words the built-in lists don't cover: articles, pronouns, the irregular
// auxiliaries and modals, conjunctions, question words, contractions.
const FUNCTION_WORDS: FnRow[] = [
  ['der,die,das,den,dem,des', 'der · die · das', 'other', 'the (definite article); also: who, which, that'],
  ['ein,eine,einen,einem,einer,eines', 'ein', 'other', 'a, an; one'],
  ['kein,keine,keinen,keinem,keiner,keines', 'kein', 'other', 'no, not a, not any'],
  ['dieser,diese,diesen,diesem,dieses', 'dieser', 'pronoun', 'this, these'],
  ['jeder,jede,jeden,jedem,jedes', 'jeder', 'pronoun', 'every, each'],
  ['welcher,welche,welchen,welchem,welches', 'welcher', 'pronoun', 'which'],
  ['ich', 'ich', 'pronoun', 'I'],
  ['mich', 'ich', 'pronoun', 'me (accusative of ich)'],
  ['mir', 'ich', 'pronoun', '(to) me (dative of ich)'],
  ['du', 'du', 'pronoun', 'you (informal, singular)'],
  ['dich', 'du', 'pronoun', 'you (accusative of du)'],
  ['dir', 'du', 'pronoun', '(to) you (dative of du)'],
  ['er', 'er', 'pronoun', 'he; it (for der-words)'],
  ['ihn', 'er', 'pronoun', 'him; it (accusative of er)'],
  ['ihm', 'er', 'pronoun', '(to) him / it (dative of er, es)'],
  ['sie', 'sie', 'pronoun', 'she; they; it (for die-words). Sie = you (formal)'],
  ['es', 'es', 'pronoun', 'it'],
  ['wir', 'wir', 'pronoun', 'we'],
  ['uns', 'wir', 'pronoun', 'us; (to) us; ourselves'],
  ['ihr', 'ihr', 'pronoun', 'you (plural); (to) her; her, their (possessive)'],
  ['euch', 'ihr', 'pronoun', 'you, (to) you (plural); yourselves'],
  ['ihnen', 'sie', 'pronoun', '(to) them. Ihnen = (to) you (formal)'],
  ['sich', 'sich', 'pronoun', 'oneself, himself, herself, themselves (reflexive)'],
  ['man', 'man', 'pronoun', 'one, you, people (in general)'],
  ['mein,meine,meinen,meinem,meiner,meines', 'mein', 'pronoun', 'my'],
  ['dein,deine,deinen,deinem,deiner,deines', 'dein', 'pronoun', 'your (informal)'],
  ['sein,seine,seinen,seinem,seiner,seines', 'sein', 'pronoun', 'his, its'],
  ['ihre,ihren,ihrem,ihrer,ihres', 'ihr', 'pronoun', 'her, their; Ihr = your (formal)'],
  ['unser,unsere,unseren,unserem,unserer,unseres,unsre,unsren', 'unser', 'pronoun', 'our'],
  ['euer,eure,euren,eurem,eurer,eures', 'euer', 'pronoun', 'your (plural)'],
  ['nichts', 'nichts', 'pronoun', 'nothing'],
  ['etwas', 'etwas', 'pronoun', 'something; a little'],
  ['alles', 'alles', 'pronoun', 'everything'],
  ['alle', 'alle', 'pronoun', 'all, everyone'],
  ['jemand,jemanden,jemandem', 'jemand', 'pronoun', 'someone'],
  ['niemand,niemanden,niemandem', 'niemand', 'pronoun', 'nobody'],
  ['und', 'und', 'conjunction', 'and'],
  ['oder', 'oder', 'conjunction', 'or'],
  ['aber', 'aber', 'conjunction', 'but'],
  ['denn', 'denn', 'conjunction', 'because, for; (in questions) then'],
  ['sondern', 'sondern', 'conjunction', 'but (rather)'],
  ['weil', 'weil', 'conjunction', 'because (verb goes to the end)'],
  ['dass', 'dass', 'conjunction', 'that (verb goes to the end)'],
  ['wenn', 'wenn', 'conjunction', 'if; when, whenever'],
  ['ob', 'ob', 'conjunction', 'whether, if'],
  ['als', 'als', 'conjunction', 'when (in the past); than; as'],
  ['obwohl', 'obwohl', 'conjunction', 'although'],
  ['bevor', 'bevor', 'conjunction', 'before'],
  ['nachdem', 'nachdem', 'conjunction', 'after'],
  ['damit', 'damit', 'conjunction', 'so that; with it'],
  ['deshalb,deswegen', 'deshalb', 'adverb', 'that is why, therefore'],
  ['trotzdem', 'trotzdem', 'adverb', 'nevertheless, anyway'],
  ['wer', 'wer', 'pronoun', 'who'],
  ['wen', 'wer', 'pronoun', 'whom (accusative)'],
  ['wem', 'wer', 'pronoun', 'to whom (dative)'],
  ['was', 'was', 'pronoun', 'what'],
  ['wo', 'wo', 'adverb', 'where'],
  ['wohin', 'wohin', 'adverb', 'where (to)'],
  ['woher', 'woher', 'adverb', 'where from'],
  ['wann', 'wann', 'adverb', 'when'],
  ['warum,wieso,weshalb', 'warum', 'adverb', 'why'],
  ['wie', 'wie', 'adverb', 'how; like, as'],
  ['nicht', 'nicht', 'adverb', 'not'],
  ['sehr', 'sehr', 'adverb', 'very'],
  ['nur', 'nur', 'adverb', 'only, just'],
  ['ja', 'ja', 'other', 'yes; (particle) after all, really'],
  ['nein', 'nein', 'other', 'no'],
  ['doch', 'doch', 'adverb', 'yes (contradicting a no); but, after all'],
  ['mal', 'mal', 'adverb', 'once; (particle) just'],
  ['hier', 'hier', 'adverb', 'here'],
  ['da', 'da', 'adverb', 'there; then; since (because)'],
  ['dort', 'dort', 'adverb', 'there'],
  ['dann', 'dann', 'adverb', 'then'],
  ['so', 'so', 'adverb', 'so, like this'],
  ['viel', 'viel', 'adverb', 'much, a lot'],
  ['viele,vielen', 'viele', 'pronoun', 'many'],
  ['bitte', 'bitte', 'other', 'please; you are welcome'],
  ['danke', 'danke', 'other', 'thank you'],
  ['wieder', 'wieder', 'adverb', 'again'],
  ['zusammen', 'zusammen', 'adverb', 'together'],
  ['vielleicht', 'vielleicht', 'adverb', 'maybe, perhaps'],
  ['also', 'also', 'adverb', 'so, therefore (not "also")'],
  ['im', 'im', 'preposition', 'in the (in + dem)'],
  ['ins', 'ins', 'preposition', 'into the (in + das)'],
  ['am', 'am', 'preposition', 'at / on the (an + dem); am … -sten = the most'],
  ['ans', 'ans', 'preposition', 'to the (an + das)'],
  ['zum', 'zum', 'preposition', 'to the (zu + dem)'],
  ['zur', 'zur', 'preposition', 'to the (zu + der)'],
  ['vom', 'vom', 'preposition', 'from / of the (von + dem)'],
  ['beim', 'beim', 'preposition', 'at the; while (bei + dem)'],
  ['ab', 'ab', 'preposition', 'from (a time or place) on; off, away'],
  ['bis', 'bis', 'preposition', 'until, by; up to'],
  ['null', 'null', 'other', 'zero'],
  ['eins', 'eins', 'other', 'one'],
  ['zwei', 'zwei', 'other', 'two'],
  ['drei', 'drei', 'other', 'three'],
  ['vier', 'vier', 'other', 'four'],
  ['fünf', 'fünf', 'other', 'five'],
  ['sechs', 'sechs', 'other', 'six'],
  ['sieben', 'sieben', 'other', 'seven'],
  ['acht', 'acht', 'other', 'eight'],
  ['neun', 'neun', 'other', 'nine'],
  ['zehn', 'zehn', 'other', 'ten'],
  ['elf', 'elf', 'other', 'eleven'],
  ['zwölf', 'zwölf', 'other', 'twelve'],
  ['zwanzig', 'zwanzig', 'other', 'twenty'],
  ['dreißig', 'dreißig', 'other', 'thirty'],
  ['hundert', 'hundert', 'other', 'hundred'],
  ['tausend', 'tausend', 'other', 'thousand'],
  ['sein,bin,bist,ist,sind,seid,war,warst,waren,wart,gewesen,wäre,wärst,wären,wärt', 'sein', 'verb', 'to be', 'ist · war · ist gewesen'],
  ['haben,habe,hast,hat,habt,hatte,hattest,hatten,hattet,gehabt,hätte,hättest,hätten,hättet', 'haben', 'verb', 'to have', 'hat · hatte · hat gehabt'],
  ['werden,werde,wirst,wird,werdet,wurde,wurdest,wurden,wurdet,geworden,worden,würde,würdest,würden,würdet', 'werden', 'verb', 'to become; will (future); würde = would', 'wird · wurde · ist geworden'],
  ['können,kann,kannst,könnt,konnte,konntest,konnten,konntet,gekonnt,könnte,könntest,könnten', 'können', 'verb', 'can, to be able to', 'kann · konnte · hat gekonnt'],
  ['müssen,muss,musst,müsst,musste,musstest,mussten,musstet,gemusst,müsste,müssten', 'müssen', 'verb', 'must, to have to', 'muss · musste · hat gemusst'],
  ['wollen,will,willst,wollt,wollte,wolltest,wollten,wolltet,gewollt', 'wollen', 'verb', 'to want (to)', 'will · wollte · hat gewollt'],
  ['sollen,soll,sollst,sollt,sollte,solltest,sollten,solltet,gesollt', 'sollen', 'verb', 'should, to be supposed to', 'soll · sollte · hat gesollt'],
  ['dürfen,darf,darfst,dürft,durfte,durftest,durften,gedurft,dürfte,dürften', 'dürfen', 'verb', 'may, to be allowed to', 'darf · durfte · hat gedurft'],
  ['mögen,mag,magst,mögt,mochte,mochtest,mochten,gemocht', 'mögen', 'verb', 'to like', 'mag · mochte · hat gemocht'],
  ['möchte,möchtest,möchten,möchtet', 'möchten', 'verb', 'would like (to)', 'möchte · wollte · hat gewollt'],
  ['wissen,weiß,weißt,wisst,wusste,wusstest,wussten,gewusst', 'wissen', 'verb', 'to know (a fact)', 'weiß · wusste · hat gewusst'],
];

// Extra forms of the function-word entries, keyed by entry id (read in WordIndex.add).
const FORMS_OF = new Map<string, string[]>();

let builtinCache: DictEntry[] | null = null;

/** Entries that ship with the app: the little words above plus the Grundwortschatz and strong-verb lists. */
export function builtinEntries(): DictEntry[] {
  if (builtinCache) return builtinCache;
  const out: DictEntry[] = [];
  FUNCTION_WORDS.forEach(([forms, lemma, pos, english, extra], i) => {
    const id = `bi:fn:${i}`;
    FORMS_OF.set(id, forms.split(','));
    out.push({ id, lemma, pos, gender: '', plural: '', forms: extra ?? '', english, source: 'builtin', functionWord: pos !== 'verb' && pos !== 'adverb' });
  });
  for (const p of PREPOSITIONS) {
    if (p.word.includes('(')) continue;
    const caseName = p.case === 'akk' ? '+ Akkusativ' : p.case === 'dat' ? '+ Dativ' : p.case === 'gen' ? '+ Genitiv' : '+ Akkusativ / Dativ';
    out.push({ id: `bi:prep:${p.word}`, lemma: p.word, pos: 'preposition', gender: '', plural: '', forms: caseName, english: p.meaning, source: 'builtin', functionWord: true });
  }
  for (const deck of STARTER_DECKS) {
    if (deck.key !== 'a1' && deck.key !== 'verben') continue;
    for (const n of deck.notes()) {
      const [e] = entriesFromNotes([{ id: n.id, type: n.type, fields: n.fields, deckId: '' }]);
      if (e) out.push({ ...e, id: `bi:${n.id}`, source: 'builtin', noteId: undefined, deckId: undefined });
    }
  }
  builtinCache = out;
  return out;
}

/** An AI lookup answer as a dictionary entry (cached per surface form). */
export interface AiLookup {
  found: boolean;
  lemma?: string;
  pos?: string;
  gender?: string;
  plural?: string;
  forms?: string;
  english?: string;
}

export function entryFromAi(word: string, r: AiLookup): DictEntry | null {
  if (!r.found || !r.lemma?.trim() || !r.english?.trim()) return null;
  const gender = parseGender(r.gender) ?? '';
  return {
    id: `ai:${word.toLowerCase()}`,
    lemma: r.lemma.trim().replace(/^(der|die|das)\s+/i, ''),
    pos: parsePos(r.pos) || (gender ? 'noun' : ''),
    gender,
    plural: (r.plural ?? '').trim(),
    forms: (r.forms ?? '').trim(),
    english: r.english.trim(),
    source: 'ai',
  };
}

/** Build an index from the learner's notes (they win over built-ins) plus the built-in entries. */
export function buildWordIndex(notes: Iterable<Pick<Note, 'id' | 'type' | 'fields' | 'deckId'>>, extra: DictEntry[] = []): WordIndex {
  const index = new WordIndex();
  index.addAll(entriesFromNotes(notes));
  index.addAll(extra);
  index.addAll(builtinEntries());
  return index;
}
