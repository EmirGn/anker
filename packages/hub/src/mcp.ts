import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NOTE_TYPES, isNoteType, type NoteInput, type NoteType } from '@anker/core';
import { z } from 'zod';
import type { Repo } from './repo';

export const MCP_INSTRUCTIONS = `Anker is the user's personal spaced-repetition flashcard app (like Anki) for learning German.
You can read and change their decks and cards with these tools. Scheduling (FSRS) is automatic — never try to set due dates.

Model:
- Decks are hierarchical; refer to them by full path with "::", e.g. "Deutsch::A2::Verben". Paths are created on demand by add_words/add_notes.
- Notes hold fields; each note generates 1+ cards. Note types:
  • word — German vocabulary (preferred for single words and short expressions). Fields: german, english, pos, gender, plural, forms, example, exampleTranslation, notes. Creates DE→EN and EN→DE cards.
  • basic — front/back. • reversed — front/back both directions. • typing — front (prompt) / back (answer the user types) / extra.
  • cloze — text with gaps like "Ich fahre {{c1::mit dem}} Bus." (+ extra). One card per c-number. Hints: {{c1::answer::hint}}.
- Field text may use **bold**, *italic* and simple HTML (<b>, <i>, <br>).

German conventions for word notes:
- german: nouns WITHOUT article and capitalised ("Tisch"), verbs in the infinitive ("fahren"), reflexive verbs with "sich" ("sich freuen").
- gender: der | die | das | pl (plural-only nouns). Always set it for nouns.
- plural: plural form without article ("Tische"); "-" when there is none.
- forms: verbs → "3rd person present · Präteritum · Perfekt", e.g. "fährt · fuhr · ist gefahren"; adjectives → "größer · am größten"; prepositions → "+ Dativ".
- example: one natural sentence at the learner's level (see get_overview → learner.level), exampleTranslation in the learner's native language.
- english: short meaning(s) in the learner's native language (field name is historical).

Good practice: call get_overview first; use lookup_words or find_notes to avoid duplicates (add_words skips duplicates automatically);
batch many words in one add_words call; keep examples short; use tags like "A2", "thema-küche", "verb-trennbar".
Report what you changed in a short summary for the user.`;

const deckRef = z.string().describe('Deck id or full path, e.g. "Deutsch::Verben"');

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function guard<A>(fn: (args: A) => unknown) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail((e as Error).message ?? String(e));
    }
  };
}

const wordShape = z.object({
  german: z.string().describe('Headword. Nouns without article, verbs in the infinitive.'),
  english: z.string().describe("Meaning in the learner's native language"),
  gender: z.enum(['der', 'die', 'das', 'pl']).optional().describe('For nouns'),
  plural: z.string().optional().describe('Plural without article, or "-"'),
  pos: z
    .enum(['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'other'])
    .optional(),
  forms: z.string().optional().describe('Verbs: "fährt · fuhr · ist gefahren"; adjectives: "größer · am größten"'),
  example: z.string().optional().describe('German example sentence'),
  exampleTranslation: z.string().optional(),
  notes: z.string().optional().describe('Usage notes, e.g. "trennbar", "+ Akk", false friends'),
  tags: z.array(z.string()).optional(),
});

export function createMcpServer(repo: Repo, version: string): McpServer {
  const server = new McpServer({ name: 'anker', version }, { instructions: MCP_INSTRUCTIONS });

  server.registerTool(
    'get_overview',
    {
      title: 'Overview',
      description:
        "Start here. Learner profile (level, native language, daily goal), totals, today's progress, streak and every deck with note counts and what is due.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(() => repo.overview()),
  );

  server.registerTool(
    'list_decks',
    {
      title: 'List decks',
      description: 'All decks as full paths with ids, note counts and due counts (new / learning / review).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(() => repo.deckSummaries()),
  );

  server.registerTool(
    'create_deck',
    {
      title: 'Create deck',
      description: 'Create a deck (and any missing parents) from a path like "Deutsch::B1::Redemittel". Returns the existing deck if it already exists.',
      inputSchema: {
        path: z.string(),
        description: z.string().optional(),
        emoji: z.string().optional().describe('A single emoji shown next to the deck'),
        new_per_day: z.number().int().min(0).max(9999).optional(),
      },
    },
    guard((a: { path: string; description?: string; emoji?: string; new_per_day?: number }) => {
      const r = repo.createDeck(a.path, {
        description: a.description,
        emoji: a.emoji,
        config: a.new_per_day !== undefined ? { newPerDay: a.new_per_day } : undefined,
      });
      return { ...r, path: repo.pathOf(r.deck.id) };
    }),
  );

  server.registerTool(
    'update_deck',
    {
      title: 'Update deck',
      description: 'Rename or move a deck, or change its description, emoji or study limits.',
      inputSchema: {
        deck: deckRef,
        rename: z.string().optional().describe('New leaf name (no "::")'),
        move_under: z.string().optional().describe('New parent path; "" moves it to the top level'),
        description: z.string().optional(),
        emoji: z.string().optional(),
        new_per_day: z.number().int().min(0).max(9999).optional(),
        reviews_per_day: z.number().int().min(0).max(99999).optional(),
        desired_retention: z.number().min(0.7).max(0.99).optional(),
      },
    },
    guard(
      (a: {
        deck: string;
        rename?: string;
        move_under?: string;
        description?: string;
        emoji?: string;
        new_per_day?: number;
        reviews_per_day?: number;
        desired_retention?: number;
      }) => {
        const config =
          a.new_per_day !== undefined || a.reviews_per_day !== undefined || a.desired_retention !== undefined
            ? { newPerDay: a.new_per_day, reviewsPerDay: a.reviews_per_day, desiredRetention: a.desired_retention }
            : undefined;
        const d = repo.updateDeck(a.deck, {
          rename: a.rename,
          parent: a.move_under,
          description: a.description,
          emoji: a.emoji,
          config,
        });
        return { deck: d, path: repo.pathOf(d.id) };
      },
    ),
  );

  server.registerTool(
    'delete_deck',
    {
      title: 'Delete deck',
      description:
        'Delete a deck and its sub-decks. Refuses if it contains notes unless delete_notes=true (which permanently deletes those notes and their review progress). Only do this when the user clearly asked.',
      inputSchema: { deck: deckRef, delete_notes: z.boolean().optional() },
      annotations: { destructiveHint: true },
    },
    guard((a: { deck: string; delete_notes?: boolean }) => repo.deleteDeck(a.deck, !!a.delete_notes)),
  );

  server.registerTool(
    'add_words',
    {
      title: 'Add vocabulary',
      description:
        'Add German vocabulary as "word" notes (DE→EN + EN→DE cards). The deck path is created if missing. Duplicates of existing words are skipped and reported. Batch up to ~100 words per call.',
      inputSchema: {
        deck: deckRef,
        words: z.array(wordShape).min(1).max(200),
        tags: z.array(z.string()).optional().describe('Tags added to every word'),
        allow_duplicates: z.boolean().optional(),
      },
    },
    guard((a: { deck: string; words: z.infer<typeof wordShape>[]; tags?: string[]; allow_duplicates?: boolean }) => {
      const deck = repo.resolveDeck(a.deck, { create: true });
      const inputs: NoteInput[] = a.words.map(({ tags, ...fields }) => ({
        deckId: deck.id,
        type: 'word',
        fields,
        tags: [...(a.tags ?? []), ...(tags ?? [])],
        source: 'ai',
      }));
      const r = repo.addNotes(inputs, { allowDuplicates: a.allow_duplicates });
      return {
        deck: repo.pathOf(deck.id),
        added: r.created.length,
        addedIds: r.created.map((n) => n.id),
        skippedDuplicates: r.skipped,
        errors: r.errors,
      };
    }),
  );

  server.registerTool(
    'add_notes',
    {
      title: 'Add notes',
      description: `Add notes of any type. Fields per type: ${Object.values(NOTE_TYPES)
        .map((t) => `${t.id}: ${t.fields.map((f) => f.key).join(', ')}`)
        .join(' | ')}. Cloze text needs {{c1::…}} gaps.`,
      inputSchema: {
        deck: deckRef,
        notes: z
          .array(
            z.object({
              type: z.enum(['word', 'basic', 'reversed', 'typing', 'cloze']),
              fields: z.record(z.string(), z.string()),
              tags: z.array(z.string()).optional(),
            }),
          )
          .min(1)
          .max(200),
        tags: z.array(z.string()).optional(),
        allow_duplicates: z.boolean().optional(),
      },
    },
    guard(
      (a: {
        deck: string;
        notes: { type: NoteType; fields: Record<string, string>; tags?: string[] }[];
        tags?: string[];
        allow_duplicates?: boolean;
      }) => {
        const deck = repo.resolveDeck(a.deck, { create: true });
        const inputs: NoteInput[] = a.notes.map((n) => {
          if (!isNoteType(n.type)) throw new Error(`Unknown note type ${n.type}`);
          return { deckId: deck.id, type: n.type, fields: n.fields, tags: [...(a.tags ?? []), ...(n.tags ?? [])], source: 'ai' };
        });
        const r = repo.addNotes(inputs, { allowDuplicates: a.allow_duplicates });
        return {
          deck: repo.pathOf(deck.id),
          added: r.created.length,
          addedIds: r.created.map((n) => n.id),
          skippedDuplicates: r.skipped,
          errors: r.errors,
        };
      },
    ),
  );

  server.registerTool(
    'find_notes',
    {
      title: 'Find notes',
      description: `Search notes. Query syntax (space = AND, "-" negates, quotes for phrases):
free text (umlaut-insensitive) · deck:"Deutsch::Verben" (includes sub-decks, * wildcard) · tag:A2 · type:word|basic|reversed|typing|cloze
gender:der|die|das|pl · pos:noun|verb|… · is:new|learning|review|due|suspended|leech|mature|young|flagged · added:7 (days) · rated:7 · <field>:value (e.g. german:haus).
Empty query returns everything (newest first).`,
      inputSchema: {
        query: z.string().default(''),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true },
    },
    guard((a: { query: string; limit: number; offset: number }) => {
      const r = repo.search(a.query, a.limit, a.offset);
      const byId = repo.deckMap();
      return {
        total: r.total,
        returned: r.results.length,
        offset: a.offset,
        notes: r.results.map((x) => repo.describeNote(x.note, x.cards, byId)),
      };
    }),
  );

  server.registerTool(
    'get_notes',
    {
      title: 'Get notes',
      description: 'Full details (all fields, tags, card states) for specific note ids.',
      inputSchema: { ids: z.array(z.string()).min(1).max(500) },
      annotations: { readOnlyHint: true },
    },
    guard((a: { ids: string[] }) => {
      const byNote = repo.cardsByNote();
      const byId = repo.deckMap();
      return a.ids.map((id) => {
        const n = repo.store.get('notes', id);
        return n ? repo.describeNote(n, byNote.get(id) ?? [], byId) : { id, error: 'not found' };
      });
    }),
  );

  server.registerTool(
    'lookup_words',
    {
      title: 'Look up words',
      description: 'Check which German words/phrases already exist in the collection (article-insensitive). Use before adding vocabulary.',
      inputSchema: { words: z.array(z.string()).min(1).max(500) },
      annotations: { readOnlyHint: true },
    },
    guard((a: { words: string[] }) => {
      const found: Record<string, { id: string; deck: string; summary: string } | null> = {};
      const byId = repo.deckMap();
      for (const w of a.words) {
        const q = w.replace(/^(der|die|das)\s+/i, '').trim();
        const r = repo.search(`german:"${q}"`, 5);
        const exact = r.results.find(
          (x) => (x.note.fields.german ?? '').toLowerCase() === q.toLowerCase(),
        ) ?? repo.search(`front:"${q}"`, 1).results[0];
        found[w] = exact
          ? { id: exact.note.id, deck: repo.pathOf(exact.note.deckId, byId), summary: repo.describeNote(exact.note, exact.cards).fields.english ?? '' }
          : null;
      }
      return found;
    }),
  );

  server.registerTool(
    'update_notes',
    {
      title: 'Update notes',
      description:
        'Edit notes: fields are merged (only the keys you pass change), tags replace or add/remove, deck moves the note. Review progress is kept. Changing cloze numbers adds/removes cards.',
      inputSchema: {
        updates: z
          .array(
            z.object({
              id: z.string(),
              fields: z.record(z.string(), z.string()).optional(),
              tags: z.array(z.string()).optional().describe('Replace all tags'),
              add_tags: z.array(z.string()).optional(),
              remove_tags: z.array(z.string()).optional(),
              deck: z.string().optional().describe('Move to this deck (path is created if missing)'),
            }),
          )
          .min(1)
          .max(300),
      },
    },
    guard(
      (a: {
        updates: {
          id: string;
          fields?: Record<string, string>;
          tags?: string[];
          add_tags?: string[];
          remove_tags?: string[];
          deck?: string;
        }[];
      }) => {
        const r = repo.updateNotes(
          a.updates.map((u) => ({ id: u.id, fields: u.fields, tags: u.tags, addTags: u.add_tags, removeTags: u.remove_tags, deck: u.deck })),
        );
        return { updated: r.updated.length, errors: r.errors };
      },
    ),
  );

  server.registerTool(
    'move_notes',
    {
      title: 'Move notes',
      description: 'Move notes (and their cards) to another deck. The deck path is created if missing.',
      inputSchema: { ids: z.array(z.string()).min(1).max(1000), deck: deckRef },
    },
    guard((a: { ids: string[]; deck: string }) => {
      const r = repo.moveNotes(a.ids, a.deck);
      return { deck: repo.pathOf(r.deck.id), moved: r.updated.length, errors: r.errors };
    }),
  );

  server.registerTool(
    'delete_notes',
    {
      title: 'Delete notes',
      description: 'Permanently delete notes and their cards (including review history progress). Only when the user asked.',
      inputSchema: { ids: z.array(z.string()).min(1).max(1000) },
      annotations: { destructiveHint: true },
    },
    guard((a: { ids: string[] }) => repo.deleteNotes(a.ids)),
  );

  server.registerTool(
    'set_card_state',
    {
      title: 'Suspend / reset cards',
      description:
        'Change scheduling state of all cards of the given notes: suspend (hide from reviews), unsuspend, bury (hide until tomorrow), unbury, forget (reset to new).',
      inputSchema: {
        note_ids: z.array(z.string()).min(1).max(1000),
        action: z.enum(['suspend', 'unsuspend', 'bury', 'unbury', 'forget']),
      },
    },
    guard((a: { note_ids: string[]; action: 'suspend' | 'unsuspend' | 'bury' | 'unbury' | 'forget' }) =>
      repo.cardAction(a.note_ids, a.action),
    ),
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember about the learner',
      description:
        'Save one lasting fact about the learner (job, interests, where they live, goals, exam dates, what they find hard) so future conversations can use it. One short sentence per call; skip trivia and facts already remembered.',
      inputSchema: { fact: z.string().min(3).max(300) },
    },
    guard((a: { fact: string }) => repo.remember(a.fact)),
  );

  server.registerTool(
    'get_study_stats',
    {
      title: 'Study statistics',
      description:
        'Retention, reviews per day, 14-day due forecast, card maturity breakdown, streak and the most difficult notes (most lapses). Use it to find weak spots and suggest mnemonics or easier cards.',
      inputSchema: { days: z.number().int().min(1).max(3650).default(30) },
      annotations: { readOnlyHint: true },
    },
    guard((a: { days: number }) => repo.stats(a.days)),
  );

  return server;
}
