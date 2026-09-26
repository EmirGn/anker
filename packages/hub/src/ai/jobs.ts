import { newId, truncate, type AIProvider, type Chat, type ChatMessage, type ChatMode } from '@anker/core';
import type { Repo } from '../repo';
import { systemPrompt, taskSpec, type TaskKind } from './prompts';
import { runAgent, type AgentRun, type AIEvent, type DoneEvent } from './runner';

export interface Job {
  id: string;
  kind: 'chat' | 'task';
  provider: AIProvider;
  chatId?: string;
  status: 'running' | 'done' | 'error';
  events: AIEvent[];
  subscribers: Set<(e: AIEvent) => void>;
  run?: AgentRun;
  result?: DoneEvent;
  createdAt: number;
  finishedAt?: number;
}

export interface JobManagerOptions {
  mcpUrl: () => string;
  token: string;
  workDir: string;
}

const MAX_EVENTS = 4000;

export class JobManager {
  private jobs = new Map<string, Job>();

  constructor(
    private repo: Repo,
    private opts: JobManagerOptions,
  ) {
    setInterval(() => this.prune(), 10 * 60_000).unref();
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  running(): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === 'running');
  }

  subscribe(id: string, fn: (e: AIEvent) => void): () => void {
    const job = this.jobs.get(id);
    if (!job) {
      fn({ type: 'done', ok: false, error: 'Job not found (the hub may have restarted).' });
      return () => {};
    }
    for (const e of job.events) fn(e);
    if (job.status !== 'running') return () => {};
    job.subscribers.add(fn);
    return () => job.subscribers.delete(fn);
  }

  cancel(id: string) {
    this.jobs.get(id)?.run?.cancel();
  }

  private createJob(kind: Job['kind'], provider: AIProvider, chatId?: string): Job {
    const job: Job = {
      id: newId(),
      kind,
      provider,
      chatId,
      status: 'running',
      events: [],
      subscribers: new Set(),
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private publish(job: Job, e: AIEvent) {
    job.events.push(e);
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
    for (const fn of job.subscribers) {
      try {
        fn(e);
      } catch {
        job.subscribers.delete(fn);
      }
    }
    if (e.type === 'done') {
      job.status = e.ok ? 'done' : 'error';
      job.result = e;
      job.finishedAt = Date.now();
      job.subscribers.clear();
    }
  }

  private prune() {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, j] of this.jobs) if (j.status !== 'running' && (j.finishedAt ?? 0) < cutoff) this.jobs.delete(id);
  }

  private saveChat(chat: Chat) {
    this.repo.store.put('chats', [{ ...chat, messages: chat.messages.slice(-400) }]);
  }

  async startChat(input: {
    chatId?: string;
    provider?: AIProvider;
    model?: string;
    mode?: ChatMode;
    message: string;
    context?: string;
  }): Promise<{ chatId: string; jobId: string }> {
    const prefs = this.repo.prefs();
    const now = Date.now();
    const existing = input.chatId ? this.repo.store.get('chats', input.chatId) : undefined;
    const provider = input.provider ?? existing?.provider ?? prefs.defaultProvider;
    const model = input.model ?? (provider === 'claude' ? prefs.claudeModel : prefs.codexModel) ?? undefined;
    const mode = input.mode ?? existing?.mode ?? 'tutor';

    let chat: Chat = existing
      ? { ...existing, messages: [...existing.messages] }
      : {
          id: input.chatId ?? newId(),
          title: truncate(input.message.replace(/\s+/g, ' ').trim(), 48) || 'New chat',
          provider,
          model,
          mode,
          messages: [],
          status: 'idle',
          createdAt: now,
          updatedAt: now,
        };

    if (chat.status === 'running' && this.running().some((j) => j.chatId === chat.id)) {
      throw new Error('This chat is still answering. Wait or stop it first.');
    }

    // Switching provider means the old CLI session can't be resumed: carry a short transcript instead.
    let transcript = '';
    if (existing && (existing.provider !== provider || existing.mode !== mode)) {
      transcript = existing.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-12)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${truncate(m.text, 600)}`)
        .join('\n\n');
      chat.sessionId = undefined;
    }

    const userMsg: ChatMessage = { id: newId(), role: 'user', text: input.message, at: now };
    chat = { ...chat, provider, model, mode, status: 'running', messages: [...chat.messages, userMsg] };
    this.saveChat(chat);

    const job = this.createJob('chat', provider, chat.id);
    let prompt = input.message;
    if (input.context) prompt = `${input.context}\n\n---\n\n${prompt}`;
    if (transcript) prompt = `(Earlier in this conversation:)\n${transcript}\n\n---\n\n${prompt}`;

    let draft: ChatMessage | null = null;
    let dirty = false;
    let lastSave = 0;
    const flush = (force = false) => {
      if (!dirty) return;
      if (!force && Date.now() - lastSave < 1500) return;
      lastSave = Date.now();
      dirty = false;
      const msgs = draft && draft.text ? [...chat.messages, draft] : chat.messages;
      this.saveChat({ ...chat, messages: msgs });
    };

    const onEvent = (e: AIEvent) => {
      switch (e.type) {
        case 'session':
          chat.sessionId = e.sessionId;
          dirty = true;
          break;
        case 'text':
          if (!draft) draft = { id: newId(), role: 'assistant', text: '', at: Date.now() };
          draft.text += e.delta;
          dirty = true;
          break;
        case 'message': {
          const msg: ChatMessage = draft ? { ...draft, text: e.text } : { id: newId(), role: 'assistant', text: e.text, at: Date.now() };
          chat.messages = [...chat.messages, msg];
          draft = null;
          dirty = true;
          break;
        }
        case 'tool': {
          const idx = chat.messages.findIndex((m) => m.tool?.id === e.id);
          const tool = { id: e.id, name: e.name, input: e.input, output: e.output, status: e.status };
          if (idx >= 0) {
            const prev = chat.messages[idx]!;
            const merged = { ...prev.tool!, ...Object.fromEntries(Object.entries(tool).filter(([, v]) => v !== undefined)) };
            chat.messages = chat.messages.map((m, i) => (i === idx ? { ...m, tool: merged } : m));
          } else {
            chat.messages = [...chat.messages, { id: newId(), role: 'tool', text: '', tool, at: Date.now() }];
          }
          dirty = true;
          break;
        }
        case 'done': {
          if (draft && (draft as ChatMessage).text) chat.messages = [...chat.messages, draft];
          draft = null;
          if (!e.ok) chat.messages = [...chat.messages, { id: newId(), role: 'error', text: e.error ?? 'Something went wrong', at: Date.now() }];
          chat.status = e.ok ? 'idle' : 'error';
          if (e.sessionId) chat.sessionId = e.sessionId;
          dirty = true;
          flush(true);
          break;
        }
      }
      if (e.type !== 'done') flush();
      this.publish(job, e);
    };

    job.run = await runAgent(
      {
        provider,
        prompt,
        systemPrompt: systemPrompt(mode, prefs),
        model: model || undefined,
        resumeSessionId: chat.sessionId,
        mcp: { url: this.opts.mcpUrl(), token: this.opts.token },
        workDir: this.opts.workDir,
        persistSession: true,
      },
      onEvent,
    );
    return { chatId: chat.id, jobId: job.id };
  }

  async startTask(input: {
    kind: TaskKind;
    provider?: AIProvider;
    model?: string;
    input: Record<string, string>;
  }): Promise<{ jobId: string; job: Job }> {
    const prefs = this.repo.prefs();
    const provider = input.provider ?? prefs.defaultProvider;
    const spec = taskSpec(input.kind, input.input, prefs);
    const job = this.createJob('task', provider);
    const model = input.model || spec.fastModel[provider] || undefined;
    job.run = await runAgent(
      {
        provider,
        prompt: spec.prompt,
        systemPrompt: spec.system,
        model,
        mcp: spec.tools ? { url: this.opts.mcpUrl(), token: this.opts.token } : null,
        jsonSchema: spec.schema,
        workDir: this.opts.workDir,
        persistSession: false,
        effort: spec.effort,
        timeoutMs: 3 * 60_000,
      },
      (e) => this.publish(job, e),
    );
    return { jobId: job.id, job };
  }

  waitFor(id: string): Promise<DoneEvent> {
    const job = this.jobs.get(id);
    if (!job) return Promise.resolve({ type: 'done', ok: false, error: 'Job not found' });
    if (job.result) return Promise.resolve(job.result);
    return job.run?.done ?? Promise.resolve({ type: 'done', ok: false, error: 'Job not started' });
  }
}
