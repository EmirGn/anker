// Otto's personal touch in the app: what he says when you arrive and what he
// suggests, built from the learner's own data (recent words, words they keep
// missing, recent chats). Computed on the device, so it costs no AI time.
import { DAY, noteTitle, plainText, type Chat, type Note, type Prefs } from '@anker/core';
import { useMemo } from 'react';
import { db } from './db';
import { useLiveQuery, usePrefs } from './hooks';
import { tr } from './i18n';

/** Something to practise out loud; the hub turns it into Otto's instructions. */
export interface OttoActivity {
  title: string;
  /** Instructions for Otto (English) */
  brief: string;
  /** Otto's first line (German) */
  opener: string;
}

export type OttoSuggestion =
  | { kind: 'ask'; id: string; label: string; prompt: string }
  | { kind: 'talk'; id: string; label: string; activity: OttoActivity }
  | { kind: 'open'; id: string; label: string; chatId: string };

export interface OttoData {
  prefs: Prefs;
  /** Notes added in the last 14 days, newest first */
  recent: Note[];
  /** Notes answered "Again" in the last 14 days, most misses first */
  missed: Note[];
  /** Chats with Otto, newest first */
  chats: Chat[];
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const ROLE_PLAYS: (OttoActivity & { id: string; from?: string })[] = [
  {
    id: 'cafe',
    title: tr('Rollenspiel: im Café bestellen'),
    brief: 'Role play in a Berlin café. You are the waiter; the learner orders drinks and cake, asks questions and pays.',
    opener: 'Hallo und herzlich willkommen! Was darf ich dir bringen?',
  },
  {
    id: 'baeckerei',
    title: tr('Rollenspiel: in der Bäckerei'),
    brief: 'Role play in a bakery. You are the baker; the learner buys bread and pastries and asks what things are.',
    opener: 'Guten Morgen! Was darf es sein?',
  },
  {
    id: 'weg',
    title: tr('Rollenspiel: nach dem Weg fragen'),
    brief: 'Role play in the street. The learner is lost and asks you the way to the train station; give simple directions and check they understood.',
    opener: 'Hallo! Du siehst ein bisschen verloren aus. Kann ich dir helfen?',
  },
  {
    id: 'kennenlernen',
    title: tr('Smalltalk: sich kennenlernen'),
    brief: 'Small talk at a party. Get to know the learner (name, where they are from, job, hobbies) and share about yourself too.',
    opener: 'Hi! Ich bin Otto. Woher kennst du die Gastgeber?',
  },
  {
    id: 'arzt',
    title: tr('Rollenspiel: beim Arzt'),
    brief: "Role play at the doctor's. You are the doctor; the learner describes how they feel. Use simple language and formal Sie.",
    opener: 'Guten Tag! Was fehlt Ihnen denn?',
  },
  {
    id: 'hotel',
    title: tr('Rollenspiel: im Hotel einchecken'),
    brief: 'Role play at a hotel reception. The learner checks in and asks about breakfast, Wi-Fi and the neighbourhood. Formal Sie.',
    opener: 'Herzlich willkommen! Haben Sie eine Reservierung?',
  },
  {
    id: 'wohnung',
    from: 'B1',
    title: tr('Rollenspiel: Wohnungsbesichtigung'),
    brief: 'Role play: the learner views a flat you rent out and asks about rent, deposit, the area and when they can move in. Formal Sie.',
    opener: 'Hallo, kommen Sie rein! Das ist die Wohnung. Haben Sie Fragen?',
  },
  {
    id: 'interview',
    from: 'B1',
    title: tr('Rollenspiel: Vorstellungsgespräch'),
    brief: 'Job interview role play. You are the interviewer: ask about experience, strengths and motivation. Formal Sie.',
    opener: 'Guten Tag, schön, dass Sie da sind. Erzählen Sie doch kurz etwas über sich.',
  },
  {
    id: 'reklamation',
    from: 'B1',
    title: tr('Rollenspiel: etwas reklamieren'),
    brief: 'Role play: the learner calls customer service about a delivery that arrived broken. You are the agent.',
    opener: 'Kundenservice, mein Name ist Otto. Wie kann ich Ihnen helfen?',
  },
];

const GRAMMAR: Record<string, { label: string; prompt: string }> = {
  A1: { label: tr('der, die, das: Tricks zum Merken'), prompt: tr('Erklär mir der, die, das mit Tricks zum Merken, und frag mich dann ab.') },
  A2: { label: tr('Dativ oder Akkusativ?'), prompt: tr('Dativ oder Akkusativ? Erklär es mir kurz mit meinen Wörtern und frag mich ab.') },
  B1: { label: tr('Perfekt oder Präteritum?'), prompt: tr('Perfekt oder Präteritum: Wann nehme ich was? Mit Beispielen und einem kleinen Quiz.') },
  B2: { label: tr('Konjunktiv II üben'), prompt: tr('Übe mit mir den Konjunktiv II: erst kurz erklären, dann Aufgaben.') },
};

const words = (notes: Note[], n: number) => notes.slice(0, n).map((x) => plainText(noteTitle(x))).join(', ');
const dayIndex = () => Math.floor(Date.now() / DAY);

export function useOttoData(): OttoData | null {
  const prefs = usePrefs();
  const since = (dayIndex() - 14) * DAY;
  // Words the learner added (themselves or with Otto); starter decks and imports don't count.
  const recent = useLiveQuery(
    async () => (await db.notes.where('createdAt').above(since).reverse().sortBy('createdAt')).filter((n) => n.source !== 'starter' && n.source !== 'import'),
    [since],
  );
  const logs = useLiveQuery(() => db.revlog.where('review').above(since).toArray(), [since]);
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().limit(10).toArray(), []);
  const missIds = useMemo(() => {
    const count = new Map<string, number>();
    for (const l of logs ?? []) if (l.rating === 1) count.set(l.noteId, (count.get(l.noteId) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  }, [logs]);
  const missed = useLiveQuery(async () => (await db.notes.bulkGet(missIds)).filter((n): n is Note => !!n), [missIds.join()]);
  return useMemo(
    () => (recent && missed && chats ? { prefs, recent, missed, chats: chats.filter((c) => c.messages.some((m) => m.role === 'user')) } : null),
    [prefs, recent, missed, chats],
  );
}

/** What Otto says when you arrive. */
export function ottoLine(d: OttoData, due: number): string {
  const last = d.chats[0];
  if (d.missed.length >= 2 && due > 0) return tr('{0} Karten warten auf dich. Wollen wir uns mit Wörtern aufwärmen, die du oft verwechselst? {1} …', due, words(d.missed, 2));
  if (d.recent.length >= 3) return tr('Diese Woche sind {0} neue Wörter dazugekommen, zum Beispiel {1}. Sollen wir sie in einem Gespräch benutzen?', d.recent.length, words(d.recent, 2));
  if (last && Date.now() - last.updatedAt < 2 * DAY) return tr('Letztes Mal ging es um „{0}“. Machen wir da weiter?', last.title);
  if (due === 0) return tr('Alle Karten erledigt. Lust auf ein kleines Gespräch auf Deutsch?');
  return tr('Worüber sprechen wir heute? Frag mich alles, oder lass uns einfach auf Deutsch reden.');
}

/** Two to four things to do with Otto right now, most personal first. */
export function ottoSuggestions(d: OttoData, max = 4): OttoSuggestion[] {
  const out: OttoSuggestion[] = [];
  const level = d.prefs.level;
  const last = d.chats[0];
  if (last && Date.now() - last.updatedAt < 3 * DAY) out.push({ kind: 'open', id: 'continue', label: tr('Weiter: {0}', last.title), chatId: last.id });

  const plays = ROLE_PLAYS.filter((p) => !p.from || LEVELS.indexOf(level) >= LEVELS.indexOf(p.from));
  const play = plays[dayIndex() % plays.length]!;
  out.push({ kind: 'talk', id: `talk-${play.id}`, label: play.title, activity: play });

  if (d.missed.length >= 2) {
    out.push({
      kind: 'ask',
      id: 'missed',
      label: tr('Frag mich meine Problemwörter ab'),
      prompt: tr('Frag mich die Wörter ab, die ich oft falsch habe: {0}. Eins nach dem anderen, und erklär mir kurz, wenn ich danebenliege.', words(d.missed, 8)),
    });
  }
  if (d.recent.length >= 3) {
    out.push({
      kind: 'ask',
      id: 'story',
      label: tr('Eine Geschichte mit meinen neuen Wörtern'),
      prompt: tr('Schreib mir eine kurze Geschichte auf Niveau {0} mit meinen neuen Wörtern: {1}. Stell mir danach drei Fragen dazu.', level, words(d.recent, 8)),
    });
  }
  const grammar = GRAMMAR[level] ?? GRAMMAR.B2!;
  out.push({ kind: 'ask', id: 'grammar', ...grammar });
  out.push({
    kind: 'ask',
    id: 'deck',
    label: tr('Bau mir ein Deck zu meinen Interessen'),
    prompt: tr('Bau mir ein kleines Deck mit 15 nützlichen Wörtern zu einem Thema, das zu mir passt. Frag mich kurz nach dem Thema, wenn du nichts über meine Interessen weißt.'),
  });
  return out.slice(0, max);
}
