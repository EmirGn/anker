import { makeNote, normalizeFields, withArticle } from '@anker/core';
import { Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DeckSelect } from '../components/DeckSelect';
import { Logo } from '../components/Logo';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { runTask } from '../lib/ai';
import { db } from '../lib/db';
import { desktop } from '../lib/desktop';
import { useHub } from '../lib/hooks';
import { addNote, createDeckPath } from '../lib/repo';

/** The small always-on-top window opened with the global shortcut (Mac app). */
export function QuickAdd() {
  const hub = useHub();
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [deckId, setDeckId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);
  const wordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const saved = localStorage.getItem('anker-quick-deck');
      if (saved && (await db.decks.get(saved))) setDeckId(saved);
      else setDeckId((await createDeckPath('Deutsch::Inbox', { emoji: '📥', description: 'Words captured with Quick Add' })).id);
    })();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && desktop?.closeQuickAdd();
    window.addEventListener('keydown', onKey);
    const onFocus = () => wordRef.current?.focus();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const submit = async () => {
    const w = word.trim();
    if (!w || !deckId || busy) return;
    setBusy(true);
    try {
      let fields: Record<string, string> = { german: w, english: meaning.trim() };
      if (hub) {
        const r = await runTask<Record<string, string>>('fill-word', { word: w, hint: meaning.trim() });
        if (r.ok && r.structured) fields = { ...r.structured, german: r.structured.german || w, ...(meaning.trim() ? { english: meaning.trim() } : {}) };
      }
      if (!fields.english) throw new Error('Add a meaning (AI is not available)');
      makeNote({ deckId, type: 'word', fields }, Date.now());
      const { note } = await addNote({ deckId, type: 'word', fields: normalizeFields('word', fields), tags: ['quick-add'] });
      setLog((l) => [{ text: `${withArticle(note.fields.german ?? '', note.fields.gender)} — ${note.fields.english}`, ok: true }, ...l].slice(0, 4));
      setWord('');
      setMeaning('');
      localStorage.setItem('anker-quick-deck', deckId);
      wordRef.current?.focus();
    } catch (e) {
      setLog((l) => [{ text: (e as Error).message, ok: false }, ...l].slice(0, 4));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drag flex h-full flex-col bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Logo size={22} />
        <span className="text-[13px] font-semibold">Quick add</span>
        <span className="ml-auto text-[11px] text-faint">Enter to add · Esc to close</span>
      </div>
      <form
        className="no-drag space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={wordRef}
          autoFocus
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="German word or phrase…"
          lang="de"
          className="h-12 w-full rounded-xl border border-line bg-bg px-3.5 font-display text-[20px] outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <input
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder={hub ? 'Meaning (optional — AI fills it in)' : 'Meaning'}
            className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[14px] outline-none focus:border-accent"
          />
          <button type="submit" disabled={busy || !word.trim()} className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Add
          </button>
        </div>
        <div className="flex items-center gap-2">
          <DeckSelect value={deckId} onChange={setDeckId} className="h-9 flex-1 text-[13px]" />
          <UmlautBar onInsert={(ch) => insertAtCaret(wordRef.current, ch, setWord)} />
        </div>
      </form>
      <div className="no-drag mt-3 space-y-1 overflow-hidden">
        {log.map((l, i) => (
          <div key={i} className={`truncate text-[12.5px] ${l.ok ? 'text-good' : 'text-again'}`}>
            {l.ok ? '✓ ' : '⚠ '}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
