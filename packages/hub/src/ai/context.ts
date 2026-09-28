// What Otto knows about the learner, written into every chat and voice call:
// profile and progress, recent and troublesome words, recent conversations and
// the facts Otto was asked to remember.
import { CardState, DAY, knownNoteCount, noteTitle, plainText, reviewsByDay, streak, truncate, type Note } from '@anker/core';
import type { Repo } from '../repo';

function label(n: Note): string {
  const title = truncate(plainText(noteTitle(n)).replace(/\s+/g, ' '), 60);
  const meaning = n.type === 'word' ? plainText(n.fields.english ?? '').split(/[;,]/)[0]?.trim() : '';
  return meaning ? `${title} (${truncate(meaning, 30)})` : title;
}

function ago(ts: number, now: number): string {
  const d = Math.floor((now - ts) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

export function learnerContext(repo: Repo, now = Date.now()): string {
  const prefs = repo.prefs();
  const notes = repo.store.all('notes');
  const byId = new Map(notes.map((n) => [n.id, n]));
  const cards = repo.store.all('cards');
  const logs = repo.store.all('revlog');
  const st = streak(reviewsByDay(logs, prefs.rolloverHour), now, prefs.rolloverHour);
  const due = cards.filter((c) => !c.suspended && c.state !== CardState.New && c.due <= now).length;
  const unseen = cards.filter((c) => c.state === CardState.New).length;

  const recent = notes
    .filter((n) => now - n.createdAt < 14 * DAY && n.source !== 'starter' && n.source !== 'import')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12);

  // Missed in the last two weeks (answered "Again"), then long-standing leeches.
  const misses = new Map<string, number>();
  for (const l of logs) if (l.rating === 1 && now - l.review < 14 * DAY) misses.set(l.noteId, (misses.get(l.noteId) ?? 0) + 1);
  const hardIds = [...misses].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const c of [...cards].sort((a, b) => b.lapses - a.lapses)) if (c.lapses >= 3 && !hardIds.includes(c.noteId)) hardIds.push(c.noteId);
  const hard = hardIds.slice(0, 10).map((id) => byId.get(id)).filter((n): n is Note => !!n);

  const chats = repo.store
    .all('chats')
    .filter((c) => c.messages.some((m) => m.role === 'user'))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const lines = [
    '## What you know about the learner',
    `- ${prefs.name ? `Name: ${prefs.name}. ` : ''}Level ${prefs.level}; explanations in ${prefs.nativeLanguage}. Daily goal: ${prefs.dailyGoal} reviews.`,
    `- Progress: ${knownNoteCount(cards)} words known, ${unseen} cards not started yet, ${due} reviews due now, ${st.current}-day streak (best ${st.longest}).`,
  ];
  if (recent.length) lines.push(`- Added recently: ${recent.map(label).join('; ')}.`);
  if (hard.length) lines.push(`- Keeps getting wrong: ${hard.map(label).join('; ')}.`);
  if (chats.length) {
    lines.push(
      `- Recent conversations with you: ${chats
        .map((c) => `"${truncate(c.title.replace(/\s+/g, ' '), 50)}" (${ago(c.updatedAt, now)}${c.messages.some((m) => m.voice) ? ', spoken' : ''})`)
        .join('; ')}.`,
    );
  }
  const notesText = (prefs.ottoNotes ?? '').trim();
  lines.push(notesText ? `- Things you remember about them:\n${notesText.replace(/^(?![-•])/gm, '- ').replace(/^/gm, '  ')}` : '- You have not saved anything about them yet.');
  return lines.join('\n');
}
