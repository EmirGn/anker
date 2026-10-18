// Tap-a-word lookups that the app couldn't resolve locally go to the AI once;
// the answer is cached per word form on the hub, so every device shares it and
// the same word never costs a second AI call.
import fs from 'node:fs';
import path from 'node:path';
import { parseGender, parsePos, type AiLookup, type AIProvider } from '@anker/core';

export interface LookupAnswer extends AiLookup {
  /** When the answer was made */
  at: number;
}

export type RunLookup = (word: string, sentence: string, provider?: AIProvider) => Promise<{ ok: boolean; structured?: unknown; error?: string }>;

const MAX_ENTRIES = 20_000;

/** Lower-case surface form, trimmed of punctuation: the cache key. */
export function lookupKey(word: string): string {
  return word
    .normalize('NFC')
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .toLowerCase()
    .slice(0, 80);
}

/** Validate the model's JSON into a clean answer. */
export function cleanAnswer(raw: unknown): AiLookup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  const found = r.found === true || r.found === 'true';
  const lemma = str(r.lemma).replace(/^(der|die|das)\s+/i, '');
  const english = str(r.english);
  if (!found || !lemma || !english) return { found: false };
  const gender = parseGender(str(r.gender)) ?? '';
  return {
    found: true,
    lemma,
    pos: parsePos(str(r.pos)) || (gender ? 'noun' : ''),
    gender,
    plural: str(r.plural),
    forms: str(r.forms),
    english,
  };
}

export class LookupService {
  private cache: Record<string, LookupAnswer> = {};
  private inflight = new Map<string, Promise<LookupAnswer | { error: string }>>();
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    dataDir: string,
    private run: RunLookup,
  ) {
    this.file = path.join(dataDir, 'lookup-cache.json');
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) this.cache = data;
    } catch {
      // no cache yet
    }
  }

  get(word: string): LookupAnswer | undefined {
    return this.cache[lookupKey(word)];
  }

  async lookup(word: string, sentence: string, provider?: AIProvider): Promise<{ cached: boolean; answer?: LookupAnswer; error?: string }> {
    const key = lookupKey(word);
    if (!key) return { cached: false, error: 'word is required' };
    const hit = this.cache[key];
    if (hit) return { cached: true, answer: hit };
    let p = this.inflight.get(key);
    if (!p) {
      p = this.ask(word, sentence, provider).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    const r = await p;
    return 'error' in r ? { cached: false, error: r.error } : { cached: false, answer: r };
  }

  private async ask(word: string, sentence: string, provider?: AIProvider): Promise<LookupAnswer | { error: string }> {
    const res = await this.run(word.trim().slice(0, 80), sentence.trim().slice(0, 400), provider);
    if (!res.ok) return { error: res.error ?? 'AI lookup failed' };
    const clean = cleanAnswer(res.structured);
    if (!clean) return { error: 'The AI answer could not be read' };
    const answer: LookupAnswer = { ...clean, at: Date.now() };
    this.cache[lookupKey(word)] = answer;
    this.scheduleSave();
    return answer;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 500);
    this.saveTimer.unref?.();
  }

  save() {
    const keys = Object.keys(this.cache);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => this.cache[a]!.at - this.cache[b]!.at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete this.cache[k]);
    }
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.cache));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.warn('[anker] could not save the lookup cache:', (e as Error).message);
    }
  }
}
