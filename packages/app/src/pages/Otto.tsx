import { noteTitle, type AIProvider, type Chat, type ChatMessage, type ChatMode, type Note } from '@anker/core';
// Otto's page: chats with Otto (formerly the Tutor). Provider and model come from Settings.
import { ArrowLeft, ArrowUp, Loader2, Mic, Plus, Square, Trash2, X } from '../components/icons';
import { OttoBadge } from '../components/Otto';
import { relativ } from '../lib/format';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardContext, Markdown } from '../components/AISheet';
import { runSuggestion, SuggestionIcon } from '../components/OttoHome';
import { ToolChip } from '../components/ToolChip';
import { useVoiceLauncher } from '../components/VoiceChat';
import { Button, cx, Empty, IconButton, Spinner, toast } from '../components/ui';
import { aiStatus, cancelJob, modelLabel, rememberProviders, startChat, streamJob, type AIEvent, type ProviderStatus } from '../lib/ai';
import { db } from '../lib/db';
import { useHub, useIsWide, useLiveQuery, usePrefs } from '../lib/hooks';
import { deleteChat } from '../lib/repo';
import { Link, navigate, useRoute } from '../lib/router';
import { syncNow } from '../lib/sync';
import { tr } from '../lib/i18n';
import { ottoLine, ottoSuggestions, useOttoData } from '../lib/otto';

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

function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="t-body-lg max-w-[85%] rounded-[18px] rounded-br-[6px] bg-hafen px-3.5 py-2.5 whitespace-pre-wrap text-on-hafen">{m.text}</div>
      </div>
    );
  if (m.role === 'tool' && m.tool) return <ToolChip name={m.tool.name} input={m.tool.input} output={m.tool.output} status={m.tool.status} />;
  if (m.role === 'error') return <div className="rounded-md bg-koralle-soft px-4 py-3 text-[15px] text-koralle-ink">{m.text}</div>;
  return <Bubble text={m.text} />;
}

function Bubble({ text }: { text: string }) {
  return (
    <div className="max-w-[92%] rounded-[18px] rounded-bl-[6px] bg-paper-raised px-4 py-2">
      <Markdown text={text} className="t-body-lg" />
    </div>
  );
}

function ChatList({ chats, active }: { chats: Chat[]; active: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      {chats.map((c) => (
        <Link
          key={c.id}
          to={`/otto/${c.id}`}
          className={cx('flex min-h-14 items-center gap-2 rounded-md px-3 py-2', c.id === active ? 'bg-hafen-soft' : 'hover:bg-paper-sunk')}
        >
          <div className="min-w-0 flex-1">
            <div className="t-label truncate">{c.title}</div>
            <div className="truncate text-[13px] text-ink-muted">
              {relativ(c.updatedAt)}
            </div>
          </div>
          {c.messages.some((m) => m.voice) && <Mic className="size-4 shrink-0 text-ink-muted" aria-label={tr('Sprachchat')} />}
          {c.status === 'running' && <Loader2 className="size-3.5 animate-spin text-hafen" />}
        </Link>
      ))}
    </div>
  );
}

export function OttoPage({ chatId, due }: { chatId: string | null; due: number }) {
  const hub = useHub();
  const wide = useIsWide();
  const prefs = usePrefs();
  const { query } = useRoute();
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().toArray(), []);
  const chat = useLiveQuery(() => (chatId ? db.chats.get(chatId) : undefined), [chatId]);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [provider, setProvider] = useState<AIProvider>(prefs.defaultProvider);
  const [mode, setMode] = useState<ChatMode>('tutor');
  const [text, setText] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [contextNote, setContextNote] = useState<Note | null>(null);
  const voice = useVoiceLauncher(chatId ?? undefined);
  const otto = useOttoData();
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
        rememberProviders(r.providers);
        // Settings picks Otto's AI; fall back to the other one if it isn't signed in.
        const ok = r.providers.filter((p) => p.installed && p.loggedIn);
        if (!ok.some((p) => p.id === prefs.defaultProvider) && ok[0]) setProvider(ok[0].id);
        const running = chatId ? r.running.find((j) => j.chatId === chatId) : undefined;
        if (running && liveJob.current !== running.id) attach(running.id, chatId!);
      })
      .catch(() => setProviders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, chatId]);

  useEffect(() => {
    setMode(chat?.mode ?? 'tutor');
  }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const noteId = query.get('note');
    if (noteId) void db.notes.get(noteId).then((n) => n && setContextNote(n));
    const q = query.get('q');
    if (q && !autoSent.current && !chatId) {
      autoSent.current = true;
      // ?go=1: asked from elsewhere (Today, a card, Grammar), so send it right away.
      if (query.get('go') === '1') void send(q);
      else setText(q);
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
      const r = await startChat({ chatId: chatId ?? undefined, provider, mode, message: msg, context });
      setContextNote(null);
      attach(r.jobId, r.chatId, msg);
      if (r.chatId !== chatId) navigate(`/otto/${r.chatId}`, { replace: !!chatId });
      void syncNow();
    } catch (e) {
      setText(msg);
      toast.error((e as Error).message);
    }
  };

  const running = !!live && !live.done;
  const noAI = providers && !providers.some((p) => p.installed && p.loggedIn);

  if (!hub) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-10">
        <Empty
          mood="sleepy"
          title={tr('Otto wohnt auf deinem Mac')}
          action={<Button variant="primary" onClick={() => navigate('/connect')}>{tr('Mit meinem Mac verbinden')}</Button>}
        >{tr('Claude und Codex laufen über deine eigenen Abos auf dem Mac. Verbinde dieses Gerät, um zu chatten, Decks zu bauen und Gespräche zu üben.')}</Empty>
      </div>
    );
  }

  const empty = shown.length === 0 && !live;
  const brain = modelLabel(providers, provider, provider === 'claude' ? prefs.claudeModel : prefs.codexModel);
  const header = (
    <div className="drag flex items-center gap-2 border-b border-line px-4 py-2.5 md:px-6">
      {!wide && !!chats?.length && (
        <IconButton label={tr('Chats')} onClick={() => navigate('/otto')}>
          <ArrowLeft className="size-5" />
        </IconButton>
      )}
      <OttoBadge size={36} mood={running ? 'thinking' : 'neutral'} />
      <div className="t-label min-w-0 flex-1 truncate">{chat?.title ?? 'Otto'}</div>
      {!running && (
        <IconButton label={tr('Mit Otto sprechen')} onClick={() => voice.open()}>
          <Mic className="size-5" />
        </IconButton>
      )}
      {chat && (
        <IconButton
          label={tr('Chat löschen')}
          onClick={async () => {
            await deleteChat(chat.id);
            navigate('/otto');
          }}
        >
          <Trash2 className="size-5" />
        </IconButton>
      )}
    </div>
  );

  const view = (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {voice.element}
      {header}
      <div ref={scroller} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-3 px-5 py-6 md:px-6">
          {empty && (
            <div className="anim-in">
              <div className="mb-7 flex flex-col items-center text-center">
                <OttoBadge size={104} mood="happy" />
                <h2 className="t-title mt-4">{prefs.name ? tr('Hallo {0}, ich bin Otto.', prefs.name) : tr('Hallo, ich bin Otto.')}</h2>
                {otto && <p className="t-body-lg mt-2 max-w-md text-ink-muted">{ottoLine(otto, due)}</p>}
                <Button variant="primary" size="lg" icon={<Mic className="size-5" />} onClick={() => voice.open()} disabled={!!noAI} className="mt-5">
                  {tr('Mit Otto sprechen')}
                </Button>
              </div>
              {otto && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {ottoSuggestions(otto, 4).map((sg) => (
                    <button
                      key={sg.id}
                      onClick={() => runSuggestion(sg, voice.open)}
                      disabled={!!noAI}
                      className="flex items-start gap-2.5 rounded-md border border-line bg-paper-raised px-4 py-3 text-left text-[15px] transition-colors duration-[120ms] hover:bg-paper-sunk disabled:opacity-50"
                    >
                      <SuggestionIcon s={sg} className="mt-0.5 size-5" />
                      <span>{sg.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {noAI && (
                <div className="mt-5 rounded-md bg-sonne px-4 py-3 text-[15px] text-on-sonne">{tr('Weder Claude noch Codex ist auf deinem Mac angemeldet.')}{' '}
                  <Link to="/settings" className="font-bold underline">{tr('Einstellungen → KI öffnen')}</Link>
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
              it.kind === 'text' ? <Bubble key={i} text={it.text} /> : <ToolChip key={it.id} name={it.name} input={it.input} output={it.output} status={it.status} />,
            )}
          {live && live.chatId === chatId && live.thinking && !live.done && (
            <div className="flex items-center gap-2 text-[13px] text-ink-muted">
              <span className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-krake-deep [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-krake-deep [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-krake-deep" />
              </span>
              {tr('Otto denkt nach …')}</div>
          )}
          {live?.error && live.chatId === chatId && <div className="rounded-md bg-koralle-soft px-4 py-3 text-[15px] text-koralle-ink">{live.error}</div>}
        </div>
      </div>
      <div className="border-t border-line bg-paper px-3 py-3 md:px-6">
        <div className="mx-auto max-w-3xl">
          {contextNote && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-paper-sunk px-3 py-1.5 text-[13px]">{tr('Zur Karte:')}{' '}<b>{noteTitle(contextNote)}</b>
              <button onClick={() => setContextNote(null)} className="text-ink-muted hover:text-ink" aria-label={tr('Kartenkontext entfernen')}>
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-md border border-line bg-paper-raised p-1.5 field-focus">
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
              placeholder={mode === 'conversation' ? tr('Schreib auf Deutsch …') : tr('Schreib Otto …')}
              className="max-h-56 min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[17px] leading-6 outline-none placeholder:text-ink-muted"
            />
            {!running && (
              <Button variant="ghost" onClick={() => voice.open()} aria-label={tr('Sprachchat')} title={tr('Sprachchat mit Otto')} className="size-11 !px-0">
                <Mic className="size-5" />
              </Button>
            )}
            {running ? (
              <Button variant="secondary" onClick={() => live && void cancelJob(live.jobId)} aria-label={tr('Stopp')} className="size-11 !px-0">
                <Square className="size-4 fill-current" />
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void send()} disabled={!text.trim() || !!noAI} aria-label={tr('Senden')} className="size-11 !px-0">
                <ArrowUp className="size-5" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-ink-muted">
            <span>
              Otto · {brain}
            </span>
            {live?.rate !== undefined && <span>{Math.round((live.rate ?? 0) * 100)}{' '}{tr('% deines 5-Stunden-Limits bei Claude verbraucht')}</span>}
          </div>
        </div>
      </div>
    </div>
  );

  if (!wide) {
    if (chatId || query.get('new') === '1' || query.get('q') || query.get('note') || chats?.length === 0) return <div className="flex h-full flex-col">{view}</div>;
    return (
      <div className="mx-auto max-w-xl px-5 pt-8 pb-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="t-title">Otto</h1>
          <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => navigate('/otto?new=1')}>{tr('Neuer Chat')}</Button>
        </div>
        {!chats ? <Spinner /> : <ChatList chats={chats} active={null} />}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="thin-scroll flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3 pt-10">
        <Button variant="secondary" icon={<Plus className="size-5" />} onClick={() => navigate('/otto')} className="w-full">{tr('Neuer Chat')}</Button>
        {chats && <ChatList chats={chats} active={chatId} />}
      </aside>
      {view}
    </div>
  );
}
