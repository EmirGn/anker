import type { AIProvider, ChatMode } from '@anker/core';
import { useEffect, useState } from 'react';
import { hub, hubFetch, sseStream } from './hub';
import { tr } from './i18n';

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderStatus {
  id: AIProvider;
  name: string;
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  account?: string;
  plan?: string;
  detail?: string;
  models: ModelOption[];
  installHint: string;
  loginInProgress?: boolean;
}

export type AIEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; delta: string }
  | { type: 'message'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; id: string; name: string; input?: unknown; status: 'running' | 'ok' | 'error'; output?: string }
  | { type: 'rate'; utilization?: number; window?: string; resetsAt?: number }
  | { type: 'log'; text: string }
  | { type: 'done'; ok: boolean; result?: string; structured?: unknown; error?: string; sessionId?: string };

export async function aiStatus(refresh = false) {
  return hubFetch<{ providers: ProviderStatus[]; running: { id: string; chatId?: string }[] }>(
    `/api/ai/status${refresh ? '?refresh=1' : ''}`,
    { timeoutMs: 45_000 },
  );
}

let providersCache: { at: number; value: ProviderStatus[] } | null = null;

/** Claude/Codex status on the Mac, shared between screens (refreshed after a minute). */
export function useProviders(): ProviderStatus[] | null {
  const [list, setList] = useState<ProviderStatus[] | null>(providersCache?.value ?? null);
  useEffect(() => {
    if (!hub() || (providersCache && Date.now() - providersCache.at < 60_000)) return;
    let alive = true;
    aiStatus()
      .then((r) => {
        providersCache = { at: Date.now(), value: r.providers };
        if (alive) setList(r.providers);
      })
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** Keep the shared status fresh after Settings reloaded it. */
export function rememberProviders(list: ProviderStatus[]) {
  providersCache = { at: Date.now(), value: list };
}

/** "Claude Sonnet 5", from the provider list and the model picked in Settings. */
export function modelLabel(providers: ProviderStatus[] | null, provider: AIProvider, model: string | undefined): string {
  const p = providers?.find((x) => x.id === provider);
  if (!p) return provider === 'claude' ? 'Claude' : 'Codex';
  const m = p.models.find((x) => x.id === (model ?? ''));
  const name = m?.label.replace(/^Default \((.*)\)$/, '$1').replace(/ \(.*\)$/, '');
  return name && name !== 'Default' ? `${p.name} ${name}` : p.name;
}

export function aiAvailable(): boolean {
  return !!hub();
}

export async function startChat(body: {
  chatId?: string;
  provider?: AIProvider;
  model?: string;
  mode?: ChatMode;
  message: string;
  context?: string;
}) {
  return hubFetch<{ chatId: string; jobId: string }>('/api/ai/chat', { body, timeoutMs: 30_000 });
}

export function streamJob(jobId: string, onEvent: (e: AIEvent) => void): () => void {
  const ac = new AbortController();
  let finished = false;
  sseStream(
    `/api/ai/jobs/${jobId}/events`,
    (_ev, data) => {
      if (data && typeof data === 'object') {
        if ((data as AIEvent).type === 'done') finished = true;
        onEvent(data as AIEvent);
      }
    },
    ac.signal,
  )
    .then(() => {
      if (!finished && !ac.signal.aborted) onEvent({ type: 'done', ok: false, error: 'Connection to the hub was lost' });
    })
    .catch((e) => {
      if (!ac.signal.aborted) onEvent({ type: 'done', ok: false, error: (e as Error).message });
    });
  return () => ac.abort();
}

export async function cancelJob(jobId: string) {
  await hubFetch(`/api/ai/jobs/${jobId}/cancel`, { method: 'POST', body: {} });
}

export type TaskKind = 'fill-word' | 'explain' | 'check-sentence' | 'examples' | 'mnemonic';

export async function runTask<T = unknown>(
  kind: TaskKind,
  input: Record<string, string>,
  opts: { provider?: AIProvider; model?: string } = {},
): Promise<{ ok: boolean; structured?: T; result?: string; error?: string }> {
  return hubFetch('/api/ai/task', { body: { kind, input, ...opts, wait: true }, timeoutMs: 240_000 });
}

/** Start a task and stream its text (for explanations). Resolves with the final text. */
export async function streamTask(
  kind: TaskKind,
  input: Record<string, string>,
  onText: (text: string) => void,
  opts: { provider?: AIProvider; model?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const { jobId } = await hubFetch<{ jobId: string }>('/api/ai/task', { body: { kind, input, provider: opts.provider, model: opts.model } });
  return new Promise((resolve, reject) => {
    let text = '';
    const stop = streamJob(jobId, (e) => {
      if (e.type === 'text') {
        text += e.delta;
        onText(text);
      } else if (e.type === 'message') {
        text = e.text;
        onText(text);
      } else if (e.type === 'done') {
        if (e.ok) resolve(e.result || text);
        else reject(new Error(e.error ?? tr('KI-Anfrage fehlgeschlagen')));
      }
    });
    opts.signal?.addEventListener('abort', () => {
      stop();
      void cancelJob(jobId).catch(() => {});
      reject(new Error(tr('Abgebrochen')));
    });
  });
}

export async function aiLogin(provider: AIProvider) {
  return hubFetch<{ started: boolean; error?: string }>('/api/ai/login', { body: { provider } });
}
