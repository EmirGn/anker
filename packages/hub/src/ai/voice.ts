// Voice chat with Otto through Codex's realtime voice: the experimental
// `thread/realtime/*` API of `codex app-server` (realtime v3 over WebRTC) on the
// user's own Codex login. The hub only brokers the WebRTC handshake and keeps
// the transcript; audio flows directly between the device and OpenAI.
// Flashcard requests are handed to a Codex agent in the same thread, which has
// Anker's MCP tools.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { newId, truncate, type Chat, type ChatMessage, type ChatToolCall } from '@anker/core';
import type { Repo } from '../repo';
import { VERSION } from '../version';
import { childEnv, findBinary } from './env';
import { learnerContext } from './context';
import { voiceBackendPrompt, voiceGreeting, voicePrompt, type VoiceActivity } from './prompts';
import { defaultCodexModel } from './providers';
import { toolOutputText } from './runner';

export type VoiceEvent =
  | { type: 'transcript'; id: string; role: 'user' | 'assistant'; delta: string }
  | { type: 'turnDone'; id: string }
  | { type: 'working'; active: boolean }
  | ({ type: 'tool' } & ChatToolCall)
  | { type: 'error'; message: string }
  | { type: 'closed'; reason?: string; chatId?: string };

/** Voices of the realtime v3 model; Codex defaults to "cove". */
export const VOICES = ['cove', 'juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol'];

type Json = Record<string, any>;
type Role = 'user' | 'assistant';

/** Stop a voice chat whose device stopped listening for events this long ago. */
const ORPHAN_MS = 90_000;
/** Quit the Codex process after this long without a voice chat. */
const IDLE_MS = 10 * 60_000;

/** A `codex app-server` child process speaking JSON-RPC over stdio. */
class AppServer {
  exited = false;
  private seq = 0;
  private stderr = '';
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private listeners = new Set<(method: string, params: Json) => void>();

  constructor(private child: ChildProcess) {
    child.stderr!.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    child.stdin!.on('error', () => {});
    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.receive(line));
    const exit = (err?: Error) => {
      if (this.exited) return;
      this.exited = true;
      const e = err ?? new Error(lastError(this.stderr) || 'Codex stopped unexpectedly.');
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
      for (const fn of this.listeners) fn('anker/exited', { message: e.message });
    };
    child.on('error', exit);
    child.on('exit', () => exit());
  }

  private receive(line: string) {
    let m: Json;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.method && m.id !== undefined) {
      // Codex asking the client something (approvals, forms): nobody is there to answer.
      this.write({ id: m.id, error: { code: -32601, message: 'Not supported in Anker voice chat' } });
    } else if (m.method) {
      for (const fn of this.listeners) fn(m.method, m.params ?? {});
    } else {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(friendly(m.error.message ?? 'Codex request failed')));
      else p.resolve(m.result);
    }
  }

  private write(msg: Json) {
    if (!this.exited) this.child.stdin!.write(`${JSON.stringify(msg)}\n`);
  }

  request<T = any>(method: string, params: Json, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.exited) return reject(new Error('Codex is not running.'));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not answer (${method}).`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string) {
    this.write({ method });
  }

  on(fn: (method: string, params: Json) => void) {
    this.listeners.add(fn);
  }

  kill() {
    if (!this.exited) this.child.kill('SIGTERM');
  }
}

interface Session {
  /** Codex thread id */
  id: string;
  /** The chat this voice chat continues, if any */
  chatId?: string;
  activity?: VoiceActivity;
  messages: ChatMessage[];
  /** Transcript turns still being spoken */
  open: Partial<Record<Role, ChatMessage>>;
  working: boolean;
  subscribers: Set<(e: VoiceEvent) => void>;
  answer?: { resolve: (sdp: string) => void; reject: (e: Error) => void };
  greeted: boolean;
  closed: boolean;
  savedChatId?: string;
  /** When the last event subscriber left (null while one is listening) */
  detachedAt: number | null;
}

export interface VoiceManagerOptions {
  mcpUrl: () => string;
  token: string;
  workDir: string;
}

export class VoiceManager {
  private server: AppServer | null = null;
  private starting: Promise<AppServer> | null = null;
  private sessions = new Map<string, Session>();
  private lastActive = Date.now();

  constructor(
    private repo: Repo,
    private opts: VoiceManagerOptions,
  ) {
    setInterval(() => this.housekeeping(), 30_000).unref();
  }

  /** Answer a device's WebRTC offer with a new realtime session. */
  async start(input: { sdp: string; voice?: string; chatId?: string; activity?: VoiceActivity }): Promise<{ sessionId: string; sdp: string }> {
    const prefs = this.repo.prefs();
    const server = await this.appServer();
    const chat = input.chatId ? this.repo.store.get('chats', input.chatId) : undefined;
    const { thread } = await server.request<{ thread: { id: string } }>('thread/start', {
      ephemeral: true,
      cwd: this.opts.workDir,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: prefs.codexModel || defaultCodexModel() || null,
      developerInstructions: voiceBackendPrompt(prefs),
    });
    const activity = input.activity?.brief
      ? { title: String(input.activity.title).slice(0, 80), brief: String(input.activity.brief).slice(0, 600), opener: String(input.activity.opener ?? '').slice(0, 200) }
      : undefined;
    const s: Session = {
      id: thread.id,
      chatId: chat?.id,
      activity,
      messages: [],
      open: {},
      working: false,
      subscribers: new Set(),
      greeted: false,
      closed: false,
      detachedAt: Date.now(),
    };
    this.sessions.set(s.id, s);
    this.lastActive = Date.now();
    const answer = new Promise<string>((resolve, reject) => (s.answer = { resolve, reject }));
    const timer = setTimeout(() => s.answer?.reject(new Error('Codex took too long to start the voice chat. Try again.')), 30_000);
    try {
      await server.request('thread/realtime/start', {
        threadId: s.id,
        outputModality: 'audio',
        version: 'v3',
        transport: { type: 'webrtc', sdp: input.sdp },
        voice: VOICES.find((v) => v === (input.voice || prefs.voice)) ?? null,
        prompt: voicePrompt(prefs, learnerContext(this.repo), activity),
        includeStartupContext: false,
        initialItems: history(chat),
      });
      return { sessionId: s.id, sdp: await answer };
    } catch (e) {
      s.closed = true;
      this.sessions.delete(s.id);
      void server.request('thread/realtime/stop', { threadId: s.id }).catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
      s.answer = undefined;
    }
  }

  /** Stream a voice chat's events, starting with the transcript so far. */
  subscribe(id: string, fn: (e: VoiceEvent) => void): () => void {
    const s = this.sessions.get(id);
    if (!s) {
      fn({ type: 'closed', reason: 'This voice chat has ended.' });
      return () => {};
    }
    for (const m of s.messages) {
      if (m.role === 'tool' && m.tool) fn({ type: 'tool', ...m.tool });
      else if (m.role === 'user' || m.role === 'assistant') {
        fn({ type: 'transcript', id: m.id, role: m.role, delta: m.text });
        if (s.open[m.role] !== m) fn({ type: 'turnDone', id: m.id });
      }
    }
    if (s.working) fn({ type: 'working', active: true });
    if (s.closed) {
      fn({ type: 'closed', chatId: s.savedChatId });
      return () => {};
    }
    s.subscribers.add(fn);
    s.detachedAt = null;
    return () => {
      s.subscribers.delete(fn);
      if (!s.subscribers.size) s.detachedAt = Date.now();
    };
  }

  /** The device's audio link is up: Otto opens the conversation. */
  async ready(id: string) {
    const s = this.sessions.get(id);
    if (!s || s.closed || s.greeted || !this.server) return;
    s.greeted = true;
    await this.server
      .request('thread/realtime/appendSpeech', { threadId: id, text: s.activity?.opener || voiceGreeting(this.repo.prefs(), !!s.chatId) })
      .catch(() => {});
  }

  /** Hang up; the transcript is kept as a chat. */
  async stop(id: string): Promise<{ chatId?: string }> {
    const s = this.sessions.get(id);
    if (!s) return {};
    if (!s.closed) {
      await this.server?.request('thread/realtime/stop', { threadId: id }, 10_000).catch(() => {});
      this.finish(s, 'ended');
    }
    return { chatId: s.savedChatId };
  }

  async shutdown() {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
    this.server?.kill();
  }

  private appServer(): Promise<AppServer> {
    if (this.server && !this.server.exited) return Promise.resolve(this.server);
    this.starting ??= this.spawnServer().finally(() => (this.starting = null));
    return this.starting;
  }

  private async spawnServer(): Promise<AppServer> {
    const bin = await findBinary('codex');
    if (!bin) throw new Error('Voice chat needs the Codex CLI on the hub computer (brew install --cask codex).');
    const args = [
      'app-server',
      '--enable',
      'realtime_conversation',
      '-c',
      'suppress_unstable_features_warning=true',
      // Someone is waiting on the line: quick answers for flashcard requests.
      '-c',
      'model_reasoning_effort="low"',
      ...isolation(),
      '-c',
      `mcp_servers.anker_hub.url=${JSON.stringify(this.opts.mcpUrl())}`,
      '-c',
      'mcp_servers.anker_hub.bearer_token_env_var="ANKER_MCP_TOKEN"',
      '-c',
      'mcp_servers.anker_hub.tool_timeout_sec=120',
      // Nobody can answer approval prompts mid-call; Anker's own tools are trusted.
      '-c',
      'mcp_servers.anker_hub.default_tools_approval_mode="approve"',
    ];
    const env = await childEnv({ ANKER_MCP_TOKEN: this.opts.token });
    const server = new AppServer(spawn(bin, args, { cwd: this.opts.workDir, env, stdio: ['pipe', 'pipe', 'pipe'] }));
    server.on((method, params) => this.onNotification(server, method, params));
    try {
      await server.request(
        'initialize',
        { clientInfo: { name: 'anker', title: 'Anker', version: VERSION }, capabilities: { experimentalApi: true, requestAttestation: false } },
        20_000,
      );
    } catch (e) {
      server.kill();
      throw e;
    }
    server.notify('initialized');
    this.server = server;
    return server;
  }

  private onNotification(server: AppServer, method: string, p: Json) {
    if (method === 'anker/exited') {
      if (this.server === server) this.server = null;
      for (const s of this.sessions.values()) {
        s.answer?.reject(new Error(p.message));
        this.fail(s, p.message);
      }
      return;
    }
    const s = typeof p.threadId === 'string' ? this.sessions.get(p.threadId) : undefined;
    if (!s || s.closed) return;
    switch (method) {
      case 'thread/realtime/sdp':
        s.answer?.resolve(p.sdp);
        break;
      case 'thread/realtime/error':
        if (s.answer) s.answer.reject(new Error(friendly(p.message)));
        else this.emit(s, { type: 'error', message: friendly(p.message) });
        break;
      case 'thread/realtime/closed':
        this.finish(s, p.reason ?? undefined);
        break;
      case 'thread/realtime/transcript/delta':
        this.transcript(s, p.role, p.delta);
        break;
      case 'thread/realtime/transcript/done':
        this.turnDone(s, p.role, p.text);
        break;
      case 'turn/started':
      case 'turn/completed':
        s.working = method === 'turn/started';
        this.emit(s, { type: 'working', active: s.working });
        break;
      case 'item/started':
      case 'item/completed':
        if (p.item?.type === 'mcpToolCall') this.tool(s, p.item, method === 'item/completed');
        break;
    }
  }

  private transcript(s: Session, role: string, delta: string) {
    if ((role !== 'user' && role !== 'assistant') || !delta) return;
    let m = s.open[role];
    if (!m) {
      m = { id: newId(), role, text: '', at: Date.now(), voice: true };
      s.open[role] = m;
      s.messages.push(m);
    }
    m.text += delta;
    this.emit(s, { type: 'transcript', id: m.id, role, delta });
  }

  private turnDone(s: Session, role: string, text: string) {
    if (role !== 'user' && role !== 'assistant') return;
    const m = s.open[role];
    if (m) {
      s.open[role] = undefined;
      this.emit(s, { type: 'turnDone', id: m.id });
    } else if (text?.trim()) {
      this.transcript(s, role, text);
      this.turnDone(s, role, '');
    }
  }

  private tool(s: Session, it: Json, completed: boolean) {
    const failed = it.status === 'failed' || !!it.error;
    const call: ChatToolCall = {
      id: `${s.id}:${it.id}`,
      name: String(it.tool ?? 'tool'),
      input: it.arguments,
      status: completed ? (failed ? 'error' : 'ok') : 'running',
      output: completed ? toolOutputText(it.error?.message ?? it.result?.content ?? it.result) : undefined,
    };
    const idx = s.messages.findIndex((m) => m.tool?.id === call.id);
    if (idx >= 0) s.messages[idx] = { ...s.messages[idx]!, tool: { ...call, output: call.output ?? s.messages[idx]!.tool?.output } };
    else s.messages.push({ id: newId(), role: 'tool', text: '', tool: call, at: Date.now() });
    this.emit(s, { type: 'tool', ...call });
  }

  private emit(s: Session, e: VoiceEvent) {
    for (const fn of s.subscribers) {
      try {
        fn(e);
      } catch {
        s.subscribers.delete(fn);
      }
    }
  }

  private fail(s: Session, message: string) {
    if (s.closed) return;
    this.emit(s, { type: 'error', message });
    this.finish(s, message);
  }

  private finish(s: Session, reason?: string) {
    if (s.closed) return;
    s.closed = true;
    s.open = {};
    const chatId = this.save(s);
    this.emit(s, { type: 'closed', reason, chatId });
    s.subscribers.clear();
    this.lastActive = Date.now();
    // Kept a little longer so a late stop request still learns the chat id.
    setTimeout(() => this.sessions.delete(s.id), 60_000).unref();
  }

  /** Keep the conversation as a chat: appended to the chat it continued, or a new one. */
  private save(s: Session): string | undefined {
    const messages = s.messages
      .map((m) => (m.role === 'tool' ? m : { ...m, text: m.text.trim() }))
      .filter((m) => m.role === 'tool' || m.text);
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) return undefined;
    const now = Date.now();
    const existing = s.chatId ? this.repo.store.get('chats', s.chatId) : undefined;
    const chat: Chat = existing
      ? // The CLI session behind the text chat didn't hear this, so the next typed message starts a fresh one with the transcript.
        { ...existing, messages: [...existing.messages, ...messages].slice(-400), sessionId: undefined, updatedAt: now }
      : {
          id: newId(),
          title: truncate(s.activity?.title ?? firstUser.text.replace(/\s+/g, ' '), 48),
          provider: 'codex',
          mode: 'conversation',
          messages,
          status: 'idle',
          createdAt: now,
          updatedAt: now,
        };
    this.repo.store.put('chats', [chat]);
    s.savedChatId = chat.id;
    return chat.id;
  }

  private housekeeping() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (!s.closed && s.detachedAt !== null && now - s.detachedAt > ORPHAN_MS) void this.stop(s.id);
    }
    if ([...this.sessions.values()].some((s) => !s.closed)) this.lastActive = now;
    else if (this.server && now - this.lastActive > IDLE_MS) {
      this.server.kill();
      this.server = null;
    }
  }
}

/** Keep the user's own Codex setup (their MCP servers, plugins and apps) out of voice chats: only Anker's tools. */
function isolation(): string[] {
  const args: string[] = [];
  for (const f of ['apps', 'plugins', 'computer_use', 'browser_use', 'multi_agent']) args.push('-c', `features.${f}=false`);
  let toml = '';
  try {
    toml = fs.readFileSync(path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml'), 'utf8');
  } catch {
    // no user config
  }
  for (const m of toml.matchAll(/^\s*\[\s*mcp_servers\.([A-Za-z0-9_-]+)\s*\]\s*$/gm)) args.push('-c', `mcp_servers.${m[1]}.enabled=false`);
  return args;
}

/** The end of the text chat a voice chat continues, so Otto knows what came before. */
function history(chat: Chat | undefined) {
  const items = (chat?.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: truncate(m.text, 600) }));
  return items.length ? items : null;
}

/** Codex relays some backend errors as raw JSON bodies. */
function friendly(message: unknown): string {
  const s = String(message ?? 'Unknown error');
  try {
    const j = JSON.parse(s);
    return String(j?.error?.message ?? j?.message ?? s);
  } catch {
    return s;
  }
}

function lastError(stderr: string): string {
  // eslint-disable-next-line no-control-regex
  const lines = stderr.replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = [...lines].reverse().find((l) => /\bERROR\b|error:/i.test(l)) ?? lines[lines.length - 1] ?? '';
  return line.replace(/^\S+Z\s+ERROR\s+\S+:\s*/, '').slice(0, 300);
}
