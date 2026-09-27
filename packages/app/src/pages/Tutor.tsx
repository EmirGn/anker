import { noteTitle, relativeTime, type AIProvider, type Chat, type ChatMessage, type ChatMode, type Note } from '@anker/core';
import { ArrowLeft, ArrowUp, Check, ChevronDown, GraduationCap, Hammer, Loader2, MessageCircle, MessagesSquare, Plus, Square, Trash2, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardContext, Markdown } from '../components/AISheet';
import { Button, cx, Empty, IconButton, Select, Spinner, toast } from '../components/ui';
import { aiStatus, cancelJob, startChat, streamJob, type AIEvent, type ProviderStatus } from '../lib/ai';
import { db } from '../lib/db';
import { useHub, useIsWide, useLiveQuery, usePrefs } from '../lib/hooks';
import { deleteChat } from '../lib/repo';
import { Link, navigate, useRoute } from '../lib/router';
import { syncNow } from '../lib/sync';

const MODES: { id: ChatMode; label: string; icon: typeof GraduationCap; blurb: string }[] = [
  { id: 'tutor', label: 'Tutor', icon: GraduationCap, blurb: 'Grammar, meanings, examples — and it can edit your decks.' },
  { id: 'builder', label: 'Deck builder', icon: Hammer, blurb: 'Creates and cleans up cards for you, then reports back.' },
  { id: 'conversation', label: 'Gespräch', icon: MessagesSquare, blurb: 'Chat in German. Mistakes get corrected, new words can be saved.' },
];

const STARTERS: Record<ChatMode, string[]> = {
  tutor: [
    'Was ist der Unterschied zwischen „seit“ und „vor“? Give me examples.',
    'When do Wechselpräpositionen take Dativ vs. Akkusativ?',
    'Quiz me on 5 words I recently added.',
    'Why is it „das Mädchen“ and not „die Mädchen“?',
  ],
  builder: [
    'Create a deck “Deutsch::Küche” with 25 A2 kitchen & cooking words.',
    'Add the 15 most common separable verbs (trennbare Verben) with examples.',
    'Find my most difficult cards and add a short mnemonic to each note.',
    'Make 10 cloze cards practising Dativ after mit, bei, nach, von, zu.',
  ],
  conversation: [
    'Hallo! Lass uns über mein Wochenende sprechen.',
    'Wir sind in einem Café in Berlin. Du bist der Kellner.',
    'Ich suche eine Wohnung. Spielen wir die Besichtigung durch?',
    'Frag mich etwas über meine Hobbys.',
  ],
};

type LiveItem = { kind: 'text'; text: string; open: boolean } | { kind: 'tool'; id: string; name: string; input?: unknown; output?: string; status: 'running' | 'ok' | 'error' };

interface Live {
  jobId: string;
  chatId: string;
  items: LiveItem[];
  thinking: boolean;
  done: boolean;
  error?: string;
  pendingUser?: string;
  rate?: number;
}

function tryJson(s?: string): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toolLabel(name: string, input: any, output?: string, status?: string): string {
  const out = tryJson(output);
  const running = status === 'running';
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  switch (name) {
    case 'get_overview':
      return running ? 'Looking at your decks…' : 'Looked at your decks';
    case 'list_decks':
      return 'Listed decks';
    case 'create_deck':
      return `${running ? 'Creating' : 'Created'} deck ${out?.path ?? input?.path ?? ''}`;
    case 'update_deck':
      return `Updated deck ${out?.path ?? input?.deck ?? ''}`;
    case 'delete_deck':
      return `Deleted deck ${input?.deck ?? ''}`;
    case 'add_words':
    case 'add_notes': {
      const count = out?.added ?? n(input?.words ?? input?.notes);
      const what = name === 'add_words' ? 'words' : 'notes';
      if (running) return `Adding ${count} ${what} to ${input?.deck ?? '…'}`;
      const skipped = out?.skippedDuplicates?.length ? ` · ${out.skippedDuplicates.length} duplicates skipped` : '';
      return `Added ${count} ${what} to ${out?.deck ?? input?.deck ?? ''}${skipped}`;
    }
    case 'find_notes':
      return `Searched “${input?.query ?? ''}”${out ? ` · ${out.total} found` : ''}`;
    case 'get_notes':
      return `Read ${n(input?.ids)} notes`;
    case 'lookup_words':
      return `Checked ${n(input?.words)} words for duplicates`;
    case 'update_notes':
      return `${running ? 'Updating' : 'Updated'} ${out?.updated ?? n(input?.updates)} notes`;
    case 'move_notes':
      return `Moved ${out?.moved ?? n(input?.ids)} notes to ${out?.deck ?? input?.deck ?? ''}`;
    case 'delete_notes':
      return `Deleted ${out?.deleted ?? n(input?.ids)} notes`;
    case 'set_card_state':
      return `${String(input?.action ?? 'Changed').replace(/^./, (c: string) => c.toUpperCase())} ${n(input?.note_ids)} notes`;
    case 'get_study_stats':
      return running ? 'Analyzing your statistics…' : 'Analyzed your statistics';
    default:
      return name;
  }
}

function ToolChip({ name, input, output, status }: { name: string; input?: unknown; output?: string; status: 'running' | 'ok' | 'error' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-[13px]',
          status === 'error' ? 'border-again/30 bg-again/8 text-again' : 'border-line bg-surface-2/60 text-muted',
        )}
      >
        {status === 'running' ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : status === 'ok' ? <Check className="size-3.5 shrink-0 text-good" /> : <X className="size-3.5 shrink-0" />}
        <Wrench className="size-3 shrink-0 opacity-50" />
        <span className="truncate">{toolLabel(name, input, output, status)}</span>
        <ChevronDown className={cx('size-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <pre className="thin-scroll mt-1.5 max-h-72 overflow-auto rounded-xl bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
          {input ? `→ ${JSON.stringify(input, null, 1)}\n\n` : ''}
          {output ? `← ${output}` : ''}
        </pre>
      )}
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] whitespace-pre-wrap">{m.text}</div>
      </div>
    );
  if (m.role === 'tool' && m.tool) return <ToolChip name={m.tool.name} input={m.tool.input} output={m.tool.output} status={m.tool.status} />;
  if (m.role === 'error') return <div className="rounded-xl bg-again/10 px-4 py-3 text-[14px] text-again">{m.text}</div>;
  return <Markdown text={m.text} className="text-[15px]" />;
}

function ChatList({ chats, active }: { chats: Chat[]; active: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      {chats.map((c) => (
        <Link
          key={c.id}
          to={`/tutor/${c.id}`}
          className={cx('group flex items-center gap-2 rounded-xl px-3 py-2.5', c.id === active ? 'bg-accent-soft' : 'hover:bg-surface-2')}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{c.title}</div>
            <div className="truncate text-[12px] text-faint">
              {c.provider === 'claude' ? 'Claude' : 'Codex'} · {MODES.find((m) => m.id === c.mode)?.label} · {relativeTime(c.updatedAt)}
            </div>
          </div>
          {c.status === 'running' && <Loader2 className="size-3.5 animate-spin text-accent" />}
        </Link>
      ))}
    </div>
  );
}

export function Tutor({ chatId }: { chatId: string | null }) {
  const hub = useHub();
  const wide = useIsWide();
  const prefs = usePrefs();
  const { query } = useRoute();
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().toArray(), []);
  const chat = useLiveQuery(() => (chatId ? db.chats.get(chatId) : undefined), [chatId]);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [provider, setProvider] = useState<AIProvider>(prefs.defaultProvider);
  const [model, setModel] = useState<string>('');
  const [mode, setMode] = useState<ChatMode>('tutor');
  const [text, setText] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [contextNote, setContextNote] = useState<Note | null>(null);
  const stopStream = useRef<(() => void) | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSent = useRef(false);
  const liveJob = useRef<string | null>(null);

  useEffect(() => {
    if (!hub) return;
    aiStatus()
      .then((r) => {
        setProviders(r.providers);
        const ok = r.providers.filter((p) => p.installed && p.loggedIn);
        if (!ok.some((p) => p.id === prefs.defaultProvider) && ok[0]) setProvider(ok[0].id);
        const running = chatId ? r.running.find((j) => j.chatId === chatId) : undefined;
        if (running && liveJob.current !== running.id) attach(running.id, chatId!);
      })
      .catch(() => setProviders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, chatId]);

  useEffect(() => {
    if (chat) {
      setProvider(chat.provider);
      setMode(chat.mode);
      setModel(chat.model ?? '');
    }
  }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chat) setModel((provider === 'claude' ? prefs.claudeModel : prefs.codexModel) ?? '');
  }, [provider, prefs.claudeModel, prefs.codexModel, chat]);

  useEffect(() => {
    const noteId = query.get('note');
    if (noteId) void db.notes.get(noteId).then((n) => n && setContextNote(n));
    const q = query.get('q');
    if (q && !autoSent.current && !chatId) {
      autoSent.current = true;
      setText(q);
    }
  }, [query, chatId]);

  // Drop the live overlay once the synced chat has caught up.
  useEffect(() => {
    if (live?.done && chat && chat.status !== 'running') setLive(null);
  }, [live?.done, chat]);

  useEffect(() => () => stopStream.current?.(), []);

  const messages = chat?.messages ?? [];
  const shown = useMemo(() => {
    if (!live || live.chatId !== chatId) return messages;
    let lastUser = -1;
    messages.forEach((m, i) => m.role === 'user' && (lastUser = i));
    const base = messages.slice(0, lastUser + 1);
    if (live.pendingUser && base[base.length - 1]?.text !== live.pendingUser) base.push({ id: 'pending', role: 'user', text: live.pendingUser, at: Date.now() });
    return base;
  }, [messages, live, chatId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [shown.length, live?.items]);

  function attach(jobId: string, forChat: string, pendingUser?: string) {
    stopStream.current?.();
    liveJob.current = jobId;
    setLive({ jobId, chatId: forChat, items: [], thinking: true, done: false, pendingUser });
    stopStream.current = streamJob(jobId, (e: AIEvent) => {
      setLive((cur) => {
        if (!cur || cur.jobId !== jobId) return cur;
        const items = [...cur.items];
        const last = items[items.length - 1];
        switch (e.type) {
          case 'text':
            if (last?.kind === 'text' && last.open) items[items.length - 1] = { ...last, text: last.text + e.delta };
            else items.push({ kind: 'text', text: e.delta, open: true });
            return { ...cur, items, thinking: false };
          case 'message':
            if (last?.kind === 'text' && last.open) items[items.length - 1] = { kind: 'text', text: e.text, open: false };
            else items.push({ kind: 'text', text: e.text, open: false });
            return { ...cur, items, thinking: false };
          case 'tool': {
            const idx = items.findIndex((it) => it.kind === 'tool' && it.id === e.id);
            if (idx >= 0) {
              const prev = items[idx] as Extract<LiveItem, { kind: 'tool' }>;
              items[idx] = { ...prev, status: e.status, output: e.output ?? prev.output, input: e.input ?? prev.input };
            } else items.push({ kind: 'tool', id: e.id, name: e.name, input: e.input, output: e.output, status: e.status });
            if (last?.kind === 'text') items[items.indexOf(last)] = { ...last, open: false };
            return { ...cur, items, thinking: e.status !== 'running' };
          }
          case 'thinking':
            return { ...cur, thinking: true };
          case 'rate':
            return { ...cur, rate: e.utilization };
          case 'done':
            void syncNow();
            return { ...cur, done: true, thinking: false, error: e.ok ? undefined : e.error };
          default:
            return cur;
        }
      });
    });
  }

  const send = async (message = text) => {
    const msg = message.trim();
    if (!msg || (live && !live.done)) return;
    setText('');
    try {
      const context = contextNote ? `The learner is asking about this flashcard from their collection (note id ${contextNote.id}):\n${cardContext(contextNote)}` : undefined;
      const r = await startChat({ chatId: chatId ?? undefined, provider, model: model || undefined, mode, message: msg, context });
      setContextNote(null);
      attach(r.jobId, r.chatId, msg);
      if (r.chatId !== chatId) navigate(`/tutor/${r.chatId}`, { replace: !!chatId });
      void syncNow();
    } catch (e) {
      setText(msg);
      toast.error((e as Error).message);
    }
  };

  const running = !!live && !live.done;
  const activeProvider = providers?.find((p) => p.id === provider);
  const noAI = providers && !providers.some((p) => p.installed && p.loggedIn);

  if (!hub) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-10">
        <Empty
          icon={<MessageCircle className="size-7" />}
          title="Your AI tutor lives on your Mac"
          action={<Button variant="primary" onClick={() => navigate('/connect')}>Connect to my Mac</Button>}
        >
          Claude and Codex run through your own subscriptions on the Mac hub. Connect this device to chat, build decks and practise conversation.
        </Empty>
      </div>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-6">
      {!wide && (
        <IconButton label="Chats" onClick={() => navigate('/tutor')}>
          <ArrowLeft className="size-5" />
        </IconButton>
      )}
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{chat?.title ?? 'New conversation'}</div>
      <Select value={provider} onChange={(e) => setProvider(e.target.value as AIProvider)} className="h-9 w-32 text-[13px]" disabled={running}>
        {(providers ?? [{ id: 'claude', name: 'Claude' } as ProviderStatus, { id: 'codex', name: 'Codex' } as ProviderStatus]).map((p) => (
          <option key={p.id} value={p.id} disabled={providers ? !(p.installed && p.loggedIn) : false}>
            {p.name}
            {providers && !(p.installed && p.loggedIn) ? ' (off)' : ''}
          </option>
        ))}
      </Select>
      {activeProvider && activeProvider.models.length > 1 && (
        <Select value={model} onChange={(e) => setModel(e.target.value)} className="h-9 w-36 text-[13px]" disabled={running}>
          {activeProvider.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      )}
      {chat && (
        <IconButton
          label="Delete chat"
          onClick={async () => {
            await deleteChat(chat.id);
            navigate('/tutor');
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </div>
  );

  const empty = shown.length === 0 && !live;
  const view = (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {header}
      <div ref={scroller} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
          {empty && (
            <div className="anim-in">
              <div className="mb-5 grid gap-2 sm:grid-cols-3">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={cx('rounded-2xl border p-3.5 text-left transition-colors', mode === m.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
                  >
                    <m.icon className="size-5 text-accent-strong" />
                    <div className="mt-2 text-[14.5px] font-semibold">{m.label}</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{m.blurb}</div>
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {STARTERS[mode].map((s) => (
                  <button key={s} onClick={() => void send(s)} disabled={!!noAI} className="rounded-2xl border border-line bg-surface px-4 py-3 text-left text-[14px] hover:bg-surface-2 disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
              {noAI && (
                <div className="mt-5 rounded-2xl bg-hard/12 px-4 py-3 text-[14px]">
                  Neither Claude nor Codex is signed in on your Mac.{' '}
                  <Link to="/settings" className="font-semibold text-accent-strong underline">
                    Open Settings → AI
                  </Link>
                </div>
              )}
            </div>
          )}
          {shown.map((m) => (
            <MessageView key={m.id} m={m} />
          ))}
          {live &&
            live.chatId === chatId &&
            live.items.map((it, i) =>
              it.kind === 'text' ? <Markdown key={i} text={it.text} className="text-[15px]" /> : <ToolChip key={it.id} name={it.name} input={it.input} output={it.output} status={it.status} />,
            )}
          {live && live.chatId === chatId && live.thinking && !live.done && (
            <div className="flex items-center gap-2 text-[13px] text-faint">
              <span className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-accent" />
              </span>
              {activeProvider?.name ?? 'AI'} is thinking…
            </div>
          )}
          {live?.error && live.chatId === chatId && <div className="rounded-xl bg-again/10 px-4 py-3 text-[14px] text-again">{live.error}</div>}
        </div>
      </div>
      <div className="border-t border-line bg-bg/80 px-3 py-3 backdrop-blur md:px-6">
        <div className="mx-auto max-w-3xl">
          {contextNote && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-[13px]">
              About: <b>{noteTitle(contextNote)}</b>
              <button onClick={() => setContextNote(null)} className="text-faint hover:text-ink" aria-label="Remove card context">
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card focus-within:border-accent">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && wide) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={mode === 'conversation' ? 'Schreib auf Deutsch…' : 'Ask anything, or tell it what cards to make…'}
              className="max-h-56 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-faint"
            />
            {running ? (
              <Button variant="secondary" onClick={() => live && void cancelJob(live.jobId)} aria-label="Stop" className="size-10 !px-0">
                <Square className="size-4 fill-current" />
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void send()} disabled={!text.trim() || !!noAI} aria-label="Send" className="size-10 !px-0">
                <ArrowUp className="size-5" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[11.5px] text-faint">
            <span>
              {MODES.find((m) => m.id === mode)?.label} · {activeProvider?.plan ?? ''}
            </span>
            {live?.rate !== undefined && <span>{Math.round((live.rate ?? 0) * 100)}% of your 5-hour Claude limit used</span>}
          </div>
        </div>
      </div>
    </div>
  );

  if (!wide) {
    if (chatId || query.get('new') === '1' || query.get('q') || query.get('note')) return <div className="flex h-full flex-col">{view}</div>;
    return (
      <div className="mx-auto max-w-xl px-4 pt-6 pb-10">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="font-display text-[28px] font-semibold">Tutor</h1>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/tutor?new=1')}>
            New chat
          </Button>
        </div>
        {!chats ? <Spinner /> : chats.length === 0 ? <div className="-mx-4">{view}</div> : <ChatList chats={chats} active={null} />}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="thin-scroll flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3 pt-10">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/tutor')} className="w-full">
          New chat
        </Button>
        {chats && <ChatList chats={chats} active={chatId} />}
      </aside>
      {view}
    </div>
  );
}
