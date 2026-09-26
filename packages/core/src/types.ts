// Shared data model for Anker. Every synced record carries `id` + `updatedAt`
// and is replicated between devices with last-writer-wins semantics.

export type TableName = 'decks' | 'notes' | 'cards' | 'revlog' | 'chats' | 'prefs';
export const SYNC_TABLES: readonly TableName[] = ['decks', 'notes', 'cards', 'revlog', 'chats', 'prefs'];

export interface BaseRecord {
  id: string;
  /** Epoch ms of the last modification. Drives last-writer-wins merges. */
  updatedAt: number;
}

export interface DeckConfig {
  newPerDay: number;
  reviewsPerDay: number;
  /** FSRS target retention, 0.7–0.99 */
  desiredRetention: number;
  learningSteps: string[];
  relearningSteps: string[];
  maximumInterval: number;
  newOrder: 'added' | 'random';
  /** Speak German text automatically when a card is shown */
  autoSpeak: boolean;
  /** Type the answer on production (EN→DE) and typing cards */
  typeAnswer: boolean;
  /** Only one card per note per day (skip siblings) */
  burySiblings: boolean;
  leechThreshold: number;
}

export interface Deck extends BaseRecord {
  /** Leaf name, e.g. "Verben". The full path is derived from parentId. */
  name: string;
  parentId: string | null;
  description?: string;
  emoji?: string;
  config?: Partial<DeckConfig>;
  createdAt: number;
}

export type NoteType = 'basic' | 'reversed' | 'cloze' | 'typing' | 'word';

/** 'pl' marks plural-only nouns (die Leute, die Ferien). */
export type Gender = 'der' | 'die' | 'das' | 'pl';

export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'preposition'
  | 'conjunction'
  | 'pronoun'
  | 'phrase'
  | 'other';

export type NoteSource = 'user' | 'ai' | 'import' | 'starter';

export interface Note extends BaseRecord {
  deckId: string;
  type: NoteType;
  /** Field values keyed by field key (see NOTE_TYPES). Light HTML / **markdown** allowed. */
  fields: Record<string, string>;
  tags: string[];
  source?: NoteSource;
  createdAt: number;
}

export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export interface Card extends BaseRecord {
  noteId: string;
  deckId: string;
  /** Template ordinal: 0 = forward, 1 = reverse; cloze N → N-1 */
  ord: number;
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: number | null;
  /** 1 when suspended (numbers index better than booleans in IndexedDB) */
  suspended: 0 | 1;
  /** Buried until this epoch ms (0 = not buried) */
  buriedUntil: number;
  /** 0 none, 1 red, 2 orange, 3 green, 4 blue */
  flag: number;
  /** Ordering key for new cards */
  position: number;
  createdAt: number;
}

export type Rating = 1 | 2 | 3 | 4;
export const RATING_LABELS: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

export interface ReviewLog extends BaseRecord {
  cardId: string;
  noteId: string;
  deckId: string;
  rating: Rating;
  /** Card state before this review */
  state: CardState;
  /** Interval (days) the card was scheduled for after this answer */
  scheduledDays: number;
  /** Interval (ms) until the next due date after this answer */
  intervalMs: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  review: number;
  durationMs: number;
}

export type AIProvider = 'claude' | 'codex';
export type ChatMode = 'tutor' | 'builder' | 'conversation';

export interface ChatToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  status: 'running' | 'ok' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  tool?: ChatToolCall;
  at: number;
}

export interface Chat extends BaseRecord {
  title: string;
  provider: AIProvider;
  model?: string;
  mode: ChatMode;
  /** CLI session / thread id, used to resume the conversation */
  sessionId?: string;
  messages: ChatMessage[];
  status: 'idle' | 'running' | 'error';
  createdAt: number;
}

/** Synced preferences (single record with id "global"). */
export interface Prefs extends BaseRecord {
  dailyGoal: number;
  rolloverHour: number;
  reminderTime: string | null; // "19:30"
  defaultProvider: AIProvider;
  claudeModel?: string;
  codexModel?: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  nativeLanguage: string;
  name?: string;
}

export type AnyRecord = Deck | Note | Card | ReviewLog | Chat | Prefs;

export interface TableRecordMap {
  decks: Deck;
  notes: Note;
  cards: Card;
  revlog: ReviewLog;
  chats: Chat;
  prefs: Prefs;
}
