// Tap a word on a card to see what it means. Words resolve locally first (the
// learner's word notes + built-in lists, see core/german/lookup.ts); only words
// nothing local knows go to the hub's AI, and every AI answer is cached on this
// device and on the hub, so a word never costs a second AI call.
import {
  buildWordIndex,
  duplicateKey,
  entryFromAi,
  guessLanguage,
  tokenizeGerman,
  type AiLookup,
  type DictEntry,
  type Note,
  type WordIndex,
} from '@anker/core';
import { useEffect, useState } from 'react';
import { db, getMeta, setMeta } from './db';
import { hub, hubFetch } from './hub';
import { addNote, createDeckPath } from './repo';

export const GESAMMELT_DECK = 'Deutsch::Gesammelt';
const AI_CACHE_KEY = 'lookup-ai';
const INDEX_TTL = 5 * 60_000;

// ---------------------------------------------------------------- AI answers (device cache)

let aiCache: Record<string, AiLookup> | null = null;

async function loadAiCache(): Promise<Record<string, AiLookup>> {
  if (!aiCache) aiCache = await getMeta<Record<string, AiLookup>>(AI_CACHE_KEY, {});
  return aiCache;
}

const aiKey = (word: string) => word.normalize('NFC').trim().toLowerCase();

/** A cached AI answer for this word form, if any (no network). */
export async function cachedAiLookup(word: string): Promise<AiLookup | undefined> {
  return (await loadAiCache())[aiKey(word)];
}

export class LookupUnavailable extends Error {}

/** Ask the hub's AI (it caches too). Throws LookupUnavailable when no Mac/AI is connected. */
export async function aiLookup(word: string, sentence: string): Promise<AiLookup> {
  const cached = await cachedAiLookup(word);
  if (cached) return cached;
  if (!hub()) throw new LookupUnavailable('not connected');
  const r = await hubFetch<{ answer?: AiLookup & { at?: number } }>('/api/ai/lookup', { body: { word, sentence }, timeoutMs: 150_000 });
  const a = r.answer;
  if (!a) throw new Error('no answer');
  const clean: AiLookup = { found: !!a.found, lemma: a.lemma, pos: a.pos, gender: a.gender, plural: a.plural, forms: a.forms, english: a.english };
  const cache = await loadAiCache();
  cache[aiKey(word)] = clean;
  await setMeta(AI_CACHE_KEY, cache);
  const entry = entryFromAi(word, clean);
  if (entry && indexState?.index) indexState.index.add(entry);
  return clean;
}

// ---------------------------------------------------------------- the index

let indexState: { at: number; index: WordIndex | null; promise: Promise<WordIndex> } | null = null;
const indexListeners = new Set<(i: WordIndex) => void>();

async function build(): Promise<WordIndex> {
  const [notes, ai] = await Promise.all([db.notes.where('type').equals('word').toArray(), loadAiCache()]);
  const extra = Object.entries(ai)
    .map(([w, a]) => entryFromAi(w, a))
    .filter((e): e is DictEntry => !!e);
  return buildWordIndex(notes, extra);
}

/** The word index (built once, refreshed after a few minutes or after adding a word). */
export function getWordIndex(): Promise<WordIndex> {
  if (!indexState || Date.now() - indexState.at > INDEX_TTL) {
    const state: NonNullable<typeof indexState> = { at: Date.now(), index: indexState?.index ?? null, promise: build() };
    indexState = state;
    state.promise
      .then((i) => {
        state.index = i;
        indexListeners.forEach((fn) => fn(i));
      })
      .catch(() => {
        if (indexState === state) indexState = null;
      });
  }
  return indexState.promise;
}

export function invalidateWordIndex() {
  if (indexState) indexState.at = 0;
}

/** The index once it's ready (null until then); re-renders when it changes. */
export function useWordIndex(enabled = true): WordIndex | null {
  const [idx, setIdx] = useState<WordIndex | null>(indexState?.index ?? null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fn = (i: WordIndex) => alive && setIdx(i);
    indexListeners.add(fn);
    void getWordIndex().then(fn, () => {});
    return () => {
      alive = false;
      indexListeners.delete(fn);
    };
  }, [enabled]);
  return idx;
}

// ---------------------------------------------------------------- collecting words

export interface CollectInput {
  german: string;
  english: string;
  pos?: string;
  gender?: string;
  plural?: string;
  forms?: string;
  example?: string;
}

/** The existing word note for this headword, if the learner already has one. */
export async function findWordNote(german: string): Promise<Note | undefined> {
  const key = duplicateKey({ type: 'word', fields: { german } });
  if (!key) return undefined;
  const notes = await db.notes.where('type').equals('word').toArray();
  return notes.find((n) => duplicateKey(n) === key);
}

/** Add a word to "Deutsch::Gesammelt"; returns null when it already exists. */
export async function collectWord(input: CollectInput): Promise<Note | null> {
  if (await findWordNote(input.german)) return null;
  const deck = await createDeckPath(GESAMMELT_DECK);
  const noun = input.pos === 'noun' || !!input.gender;
  const { note } = await addNote({
    deckId: deck.id,
    type: 'word',
    fields: {
      german: input.german,
      english: input.english || '?',
      pos: input.pos ?? '',
      gender: noun ? input.gender ?? '' : '',
      plural: noun ? input.plural ?? '' : '',
      forms: input.forms ?? '',
      example: input.example ?? '',
      exampleTranslation: '',
    },
    tags: input.english ? ['gesammelt'] : ['gesammelt', 'bedeutung-fehlt'],
  });
  invalidateWordIndex();
  if (indexState?.index) indexState.index.add({ id: note.id, lemma: input.german, pos: (input.pos ?? '') as DictEntry['pos'], gender: (noun ? input.gender ?? '' : '') as DictEntry['gender'], plural: input.plural ?? '', forms: input.forms ?? '', english: input.english, source: 'note', noteId: note.id, deckId: deck.id });
  return note;
}

// ---------------------------------------------------------------- making card text tappable

/** 'de' = every word is German; 'mixed' = decide per sentence (English explanations stay plain). */
export type TapMode = 'de' | 'mixed';

const SEGMENT = /[^.!?;:\n()[\]–—=→|]+/g;
const SKIP = '.cloze, code, pre, a, rt, rp';
const wrapCache = new Map<string, string>();

/**
 * Wrap the words of already-sanitized card HTML in <span class="tw"> so they can be
 * tapped. Works on DOM text nodes (textContent in, textContent out), never on raw strings.
 */
export function wrapWords(html: string, mode: TapMode, index: WordIndex | null): string {
  if (!html) return html;
  const key = `${mode}|${index ? index.size : 0}|${html}`;
  const hit = wrapCache.get(key);
  if (hit !== undefined) return hit;

  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  const full = root.textContent ?? '';

  // Language per sentence-ish segment of the whole field (for mixed fields).
  const segments: { start: number; end: number; lang: 'de' | 'en' | null }[] = [];
  if (mode === 'mixed') for (const m of full.matchAll(SEGMENT)) segments.push({ start: m.index!, end: m.index! + m[0].length, lang: guessLanguage(m[0]) });
  const langAt = (offset: number) => (mode === 'de' ? 'de' : (segments.find((s) => offset >= s.start && offset < s.end)?.lang ?? null));

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  let offset = 0;
  for (const node of nodes) {
    const text = node.data;
    const base = offset;
    offset += text.length;
    if (node.parentElement?.closest(SKIP)) continue;
    const tokens = tokenizeGerman(text);
    if (!tokens.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    let wrapped = 0;
    for (const t of tokens) {
      const lang = langAt(base + t.start);
      const ok = lang === 'de' || (lang === null && (index ? index.lookup(t.word).length > 0 : /[äöüß]/i.test(t.word)));
      if (!ok) continue;
      if (t.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, t.start)));
      const span = document.createElement('span');
      span.className = 'tw';
      span.textContent = t.word;
      frag.appendChild(span);
      pos = t.end;
      wrapped++;
    }
    if (!wrapped) continue;
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.replaceWith(frag);
  }
  const out = tpl.innerHTML;
  if (wrapCache.size > 500) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}
