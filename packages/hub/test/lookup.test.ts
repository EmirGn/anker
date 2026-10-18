import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanAnswer, LookupService, lookupKey, type RunLookup } from '../src/ai/lookup';

const dirs: string[] = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anker-lookup-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const answer = { found: true, lemma: 'das Wochenende', pos: 'noun', gender: 'das', plural: 'Wochenenden', forms: '', english: 'weekend' };

describe('AI word lookup cache', () => {
  it('asks the AI once per word form and remembers the answer across restarts', async () => {
    const dir = tmp();
    let calls = 0;
    const run: RunLookup = async () => {
      calls++;
      return { ok: true, structured: answer };
    };
    const svc = new LookupService(dir, run);
    const [a, b] = await Promise.all([svc.lookup('Wochenende', 'Am Wochenende schlafe ich.'), svc.lookup('wochenende', '')]);
    expect(calls).toBe(1);
    expect(a.answer).toMatchObject({ lemma: 'Wochenende', gender: 'das', english: 'weekend' });
    expect(b.answer?.lemma).toBe('Wochenende');
    const c = await svc.lookup('Wochenende.', 'x');
    expect(c.cached).toBe(true);
    expect(calls).toBe(1);

    svc.save();
    const again = new LookupService(dir, run);
    expect((await again.lookup('WOCHENENDE', '')).cached).toBe(true);
    expect(calls).toBe(1);
  });

  it('does not cache failures (AI not connected)', async () => {
    let calls = 0;
    const svc = new LookupService(tmp(), async () => {
      calls++;
      return { ok: false, error: 'Claude is not logged in' };
    });
    expect((await svc.lookup('Quatsch', '')).error).toMatch(/not logged in/);
    await svc.lookup('Quatsch', '');
    expect(calls).toBe(2);
  });

  it('caches "not a German word" answers too', async () => {
    let calls = 0;
    const svc = new LookupService(tmp(), async () => {
      calls++;
      return { ok: true, structured: { found: false, lemma: '', pos: '', gender: '', plural: '', forms: '', english: '' } };
    });
    expect((await svc.lookup('weekend', '')).answer?.found).toBe(false);
    expect((await svc.lookup('weekend', '')).cached).toBe(true);
    expect(calls).toBe(1);
  });

  it('cleans model output', () => {
    expect(cleanAnswer(answer)).toMatchObject({ found: true, lemma: 'Wochenende', pos: 'noun', gender: 'das' });
    expect(cleanAnswer({ found: true, lemma: 'Hund', english: 'dog', gender: 'm' })).toMatchObject({ gender: 'der', pos: 'noun' });
    expect(cleanAnswer({ found: true, lemma: '', english: 'x' })).toEqual({ found: false });
    expect(cleanAnswer('nope')).toBeNull();
    expect(lookupKey(' „Häuser“, ')).toBe('häuser');
  });
});
