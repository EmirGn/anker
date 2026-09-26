import { desktop } from './desktop';
import { getMeta, setMeta } from './db';

export interface HubConn {
  url: string;
  token: string;
  hubId?: string;
  name?: string;
  /** Alternative addresses (LAN, Tailscale…) tried when `url` is unreachable */
  urls?: string[];
  local?: boolean;
}

let conn: HubConn | null = null;
const listeners = new Set<() => void>();

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function initHub() {
  if (desktop) {
    conn = { url: desktop.hubUrl, token: desktop.token, local: true };
    return;
  }
  conn = await getMeta<HubConn | null>('hub', null);
  const envUrl = import.meta.env.VITE_HUB_URL as string | undefined;
  const envToken = import.meta.env.VITE_HUB_TOKEN as string | undefined;
  if (!conn && envUrl && envToken) conn = { url: envUrl, token: envToken, local: true };
}

export function hub(): HubConn | null {
  return conn;
}

export function isDesktopHub(): boolean {
  return !!desktop;
}

export async function setHub(c: HubConn | null) {
  conn = c;
  if (!desktop) await setMeta('hub', c);
  listeners.forEach((fn) => fn());
}

export function onHubChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function normalizeBase(u: string): string {
  let s = u.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  if (!/:\d+$/.test(s.replace(/^https?:\/\//, '')) && !/^https:/i.test(s)) s = `${s}:4747`;
  return s;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export async function hubFetch<T = any>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const c = conn;
  if (!c) throw new HubError(0, 'Not connected to a hub');
  const candidates = [c.url, ...(c.urls ?? []).filter((u) => u !== c.url)];
  let lastErr: unknown = null;
  for (const base of candidates) {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
        headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: withTimeout(init.signal, init.timeoutMs ?? 20_000),
      });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      lastErr = e;
      continue;
    }
    if (base !== c.url && conn === c) {
      conn = { ...c, url: base };
      if (!desktop) void setMeta('hub', conn);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HubError(res.status, (data as { error?: string }).error ?? res.statusText);
    return data as T;
  }
  throw new HubError(0, lastErr instanceof Error && lastErr.name === 'TimeoutError' ? 'Hub timed out' : 'Hub unreachable');
}

/** Minimal SSE client over fetch (EventSource can't send auth headers). */
export async function sseStream(
  path: string,
  onEvent: (event: string, data: any) => void,
  signal: AbortSignal,
): Promise<void> {
  const c = conn;
  if (!c) throw new HubError(0, 'Not connected');
  const res = await fetch(c.url + path, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'text/event-stream' }, signal });
  if (!res.ok || !res.body) throw new HubError(res.status, `Stream failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        onEvent(event, JSON.parse(data.join('\n')));
      } catch {
        onEvent(event, data.join('\n'));
      }
    }
  }
}

export async function probeHub(url: string): Promise<{ hubId: string; name: string; version: string } | null> {
  try {
    const res = await fetch(`${normalizeBase(url)}/api/health`, { signal: AbortSignal.timeout(4000) });
    const d = await res.json();
    return d?.app === 'anker' ? d : null;
  } catch {
    return null;
  }
}

/** Exchange a 6-digit pairing code for a device token. */
export async function pairWithHub(url: string, code: string, deviceName: string): Promise<HubConn> {
  const base = normalizeBase(url);
  let res: Response;
  try {
    res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceName }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HubError(0, `Can't reach ${base}. Same Wi‑Fi (or Tailscale)? Is Anker running on the Mac?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HubError(res.status, data.error ?? 'Pairing failed');
  const c: HubConn = { url: base, token: data.token, hubId: data.hubId, name: data.name, urls: [base] };
  await setHub(c);
  try {
    const info = await hubFetch<{ urls: string[] }>('/api/hub');
    const port = new URL(base).port;
    const extra = info.urls.filter((u) => !u.includes('127.0.0.1') && new URL(u).port === port);
    await setHub({ ...c, urls: [...new Set([base, ...extra])] });
  } catch {
    // keep the single address
  }
  return c;
}

export async function connectWithToken(url: string, token: string): Promise<HubConn> {
  const base = normalizeBase(url);
  const c: HubConn = { url: base, token, urls: [base] };
  const prev = conn;
  conn = c;
  try {
    const info = await hubFetch<{ hubId: string; name: string }>('/api/hub');
    const full = { ...c, hubId: info.hubId, name: info.name };
    await setHub(full);
    return full;
  } catch (e) {
    conn = prev;
    throw e;
  }
}
