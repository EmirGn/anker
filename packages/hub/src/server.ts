import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SYNC_TABLES, type AIProvider, type AnyRecord, type SyncChange, type SyncRequest, type SyncResponse, type TableName } from '@anker/core';
import type { JobManager } from './ai/jobs';
import type { TaskKind } from './ai/prompts';
import type { VoiceManager } from './ai/voice';
import { logout, providerStatuses, startLogin } from './ai/providers';
import { hashToken, randomToken, saveConfig, type HubConfig } from './config';
import { configSnippets, installIntegration, integrationStatus, removeIntegration, type IntegrationTarget, type StdioCommand } from './integrations';
import { createMcpServer } from './mcp';
import { lanAddresses } from './net';
import { pairPage } from './pair-page';
import type { Repo } from './repo';
import type { Store } from './store';

type AuthLevel = 'none' | 'any' | 'admin';

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  auth: { kind: 'admin' | 'device'; deviceId?: string } | null;
  body: <T = any>() => Promise<T>;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: AuthLevel;
  handler: (ctx: Ctx) => unknown | Promise<unknown>;
}

export interface ServerDeps {
  config: HubConfig;
  dataDir: string;
  store: Store;
  repo: Repo;
  jobs: JobManager;
  voice: VoiceManager;
  version: string;
  webRoot: string | null;
  stdioProxy: StdioCommand | null;
  port: () => number;
  onSettingsChanged: (patch: Partial<HubConfig>) => Promise<void> | void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
};

const MAX_BODY = 50 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function setCors(req: IncomingMessage, res: ServerResponse) {
  // Every API call needs a bearer token (never a cookie), so reflecting the
  // origin cannot be abused by other websites: they have no token to send.
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '600');
}

function startSse(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': anker\n\n');
  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 20_000);
  res.on('close', () => clearInterval(ping));
  return send;
}

export function createServer(deps: ServerDeps) {
  const { config, store, repo, jobs, voice, dataDir } = deps;
  const routes: Route[] = [];
  const add = (method: string, p: string, auth: AuthLevel, handler: Route['handler']) => {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${p.replace(/\//g, '\\/').replace(/:(\w+)/g, (_m, k: string) => {
        keys.push(k);
        return '([^/]+)';
      })}$`,
    );
    routes.push({ method, pattern, keys, auth, handler });
  };

  // ---- auth ---------------------------------------------------------------
  let lastSeenSave = 0;
  const authenticate = (req: IncomingMessage, url: URL): Ctx['auth'] => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : url.searchParams.get('token') ?? '';
    if (!token) return null;
    const a = Buffer.from(hashToken(token));
    const b = Buffer.from(hashToken(config.adminToken));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { kind: 'admin' };
    const h = hashToken(token);
    const dev = config.devices.find((d) => d.tokenHash === h);
    if (!dev) return null;
    const now = Date.now();
    if (!dev.lastSeenAt || now - dev.lastSeenAt > 60_000) {
      dev.lastSeenAt = now;
      if (now - lastSeenSave > 60_000) {
        lastSeenSave = now;
        saveConfig(dataDir, config);
      }
    }
    return { kind: 'device', deviceId: dev.id };
  };

  // ---- pairing -------------------------------------------------------------
  let pairing: { code: string; expiresAt: number; attempts: number } | null = null;

  const hubUrls = () => {
    const port = deps.port();
    const urls = [`http://127.0.0.1:${port}`];
    if (config.lanEnabled) for (const a of lanAddresses()) urls.push(`http://${a.address}:${port}`);
    return urls;
  };

  add('GET', '/api/health', 'none', () => ({
    app: 'anker',
    hubId: config.hubId,
    name: config.name,
    version: deps.version,
    time: Date.now(),
  }));

  add('POST', '/api/pair/start', 'admin', () => {
    pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: Date.now() + 10 * 60_000, attempts: 0 };
    const lan = lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${deps.port()}` }));
    return { code: pairing.code, expiresAt: pairing.expiresAt, addresses: lan, lanEnabled: config.lanEnabled, hubId: config.hubId, name: config.name };
  });

  add('POST', '/api/pair', 'none', async (ctx) => {
    const body = await ctx.body<{ code?: string; deviceName?: string }>();
    if (!pairing || Date.now() > pairing.expiresAt) throw new HttpError(400, 'No active pairing code. Create one in Anker on your Mac: Settings → Sync & devices → Pair a device.');
    pairing.attempts++;
    if (pairing.attempts > 10) {
      pairing = null;
      throw new HttpError(429, 'Too many attempts. Create a new pairing code.');
    }
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (code !== pairing.code) throw new HttpError(401, 'Wrong pairing code.');
    pairing = null;
    const token = randomToken();
    const device = {
      id: crypto.randomUUID(),
      name: String(body.deviceName ?? 'Device').slice(0, 60),
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    config.devices.push(device);
    saveConfig(dataDir, config);
    return { token, deviceId: device.id, hubId: config.hubId, name: config.name };
  });

  add('GET', '/api/devices', 'admin', () =>
    config.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt })),
  );

  add('DELETE', '/api/devices/:id', 'admin', (ctx) => {
    const before = config.devices.length;
    config.devices = config.devices.filter((d) => d.id !== ctx.params.id);
    saveConfig(dataDir, config);
    return { removed: before - config.devices.length };
  });

  add('GET', '/api/hub', 'any', (ctx) => ({
    hubId: config.hubId,
    name: config.name,
    version: deps.version,
    port: deps.port(),
    lanEnabled: config.lanEnabled,
    urls: hubUrls(),
    you: ctx.auth?.kind,
    counts: { decks: store.count('decks'), notes: store.count('notes'), cards: store.count('cards'), reviews: store.count('revlog') },
    ...(ctx.auth?.kind === 'admin' ? { dataDir, devices: config.devices.length } : {}),
  }));

  add('POST', '/api/hub/settings', 'admin', async (ctx) => {
    const body = await ctx.body<{ name?: string; lanEnabled?: boolean }>();
    const patch: Partial<HubConfig> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
    if (typeof body.lanEnabled === 'boolean') patch.lanEnabled = body.lanEnabled;
    await deps.onSettingsChanged(patch);
    return { ok: true, name: config.name, lanEnabled: config.lanEnabled };
  });

  // ---- sync ----------------------------------------------------------------
  add('POST', '/api/sync', 'any', async (ctx) => {
    const body = await ctx.body<SyncRequest>();
    const now = Date.now();
    const incoming: SyncChange[] = Array.isArray(body.changes) ? body.changes : [];
    const clamped: SyncChange[] = [];
    const valid = incoming.filter((c) => {
      if (!c || !SYNC_TABLES.includes(c.table as TableName) || typeof c.id !== 'string' || !c.id) return false;
      if (typeof c.updatedAt !== 'number' || !Number.isFinite(c.updatedAt)) return false;
      if (!c.deleted && (!c.data || typeof c.data !== 'object' || (c.data as AnyRecord).id !== c.id)) return false;
      if (c.updatedAt > now + 5 * 60_000) {
        // A device clock far in the future would win every conflict forever.
        c.updatedAt = now;
        if (c.data) (c.data as AnyRecord).updatedAt = now;
        clamped.push(c);
      }
      return true;
    });
    const { rejected } = store.write(
      valid.map((c) => ({ table: c.table, id: c.id, updatedAt: c.updatedAt, deleted: !!c.deleted, data: c.deleted ? null : c.data })),
    );
    const since = Math.max(0, Number(body.since) || 0);
    const limit = Math.min(5000, Math.max(50, Number(body.limit) || 2000));
    const page = store.changesSince(since, limit);
    const seq = page.more ? page.changes[page.changes.length - 1]!.seq : store.seq;
    const toChange = (r: { table: TableName; id: string; updatedAt: number; deleted: boolean; data: AnyRecord | null }): SyncChange => ({
      table: r.table,
      id: r.id,
      updatedAt: r.updatedAt,
      deleted: r.deleted || undefined,
      data: r.deleted ? null : r.data,
    });
    const res: SyncResponse = {
      hubId: config.hubId,
      seq,
      changes: page.changes.map(toChange),
      more: page.more,
      rejected: [...rejected.map(toChange), ...clamped],
      serverTime: now,
    };
    return res;
  });

  add('GET', '/api/events', 'any', (ctx) => {
    const send = startSse(ctx.res);
    send('hello', { seq: store.seq, hubId: config.hubId });
    let timer: NodeJS.Timeout | null = null;
    const off = store.onChange(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        send('change', { seq: store.seq });
      }, 150);
    });
    ctx.res.on('close', () => {
      off();
      if (timer) clearTimeout(timer);
    });
    return KEEP_OPEN;
  });

  add('GET', '/api/export', 'any', () => {
    const dump: Record<string, unknown> = { app: 'anker', version: 1, exportedAt: Date.now() };
    for (const t of SYNC_TABLES) dump[t] = store.all(t);
    return dump;
  });

  add('POST', '/api/backup', 'admin', () => ({ file: store.backup() }));

  // ---- AI --------------------------------------------------------------------
  add('GET', '/api/ai/status', 'any', async (ctx) => ({
    providers: await providerStatuses(ctx.url.searchParams.get('refresh') === '1'),
    running: jobs.running().map((j) => ({ id: j.id, kind: j.kind, chatId: j.chatId, provider: j.provider })),
  }));

  add('POST', '/api/ai/login', 'admin', async (ctx) => {
    const { provider } = await ctx.body<{ provider: AIProvider }>();
    if (provider !== 'claude' && provider !== 'codex') throw new HttpError(400, 'provider must be claude or codex');
    return startLogin(provider);
  });

  add('POST', '/api/ai/logout', 'admin', async (ctx) => {
    const { provider } = await ctx.body<{ provider: AIProvider }>();
    if (provider !== 'claude' && provider !== 'codex') throw new HttpError(400, 'provider must be claude or codex');
    await logout(provider);
    return { ok: true };
  });

  add('POST', '/api/ai/chat', 'any', async (ctx) => {
    const body = await ctx.body<{
      chatId?: string;
      provider?: AIProvider;
      model?: string;
      mode?: 'tutor' | 'builder' | 'conversation';
      message: string;
      context?: string;
    }>();
    if (!body.message?.trim()) throw new HttpError(400, 'message is required');
    try {
      return await jobs.startChat({ ...body, message: body.message.trim() });
    } catch (e) {
      throw new HttpError(409, (e as Error).message);
    }
  });

  add('POST', '/api/ai/task', 'any', async (ctx) => {
    const body = await ctx.body<{ kind: TaskKind; provider?: AIProvider; model?: string; input: Record<string, string>; wait?: boolean }>();
    const allowed: TaskKind[] = ['fill-word', 'explain', 'check-sentence', 'examples', 'mnemonic'];
    if (!allowed.includes(body.kind)) throw new HttpError(400, `kind must be one of ${allowed.join(', ')}`);
    const { jobId } = await jobs.startTask({ kind: body.kind, provider: body.provider, model: body.model, input: body.input ?? {} });
    if (!body.wait) return { jobId };
    const done = await jobs.waitFor(jobId);
    return { jobId, ...done };
  });

  add('GET', '/api/ai/jobs/:id', 'any', (ctx) => {
    const j = jobs.get(ctx.params.id!);
    if (!j) throw new HttpError(404, 'Job not found');
    return { id: j.id, kind: j.kind, status: j.status, chatId: j.chatId, result: j.result };
  });

  add('GET', '/api/ai/jobs/:id/events', 'any', (ctx) => {
    const send = startSse(ctx.res);
    const off = jobs.subscribe(ctx.params.id!, (e) => {
      send('ai', e);
      if (e.type === 'done') setTimeout(() => ctx.res.end(), 50);
    });
    ctx.res.on('close', off);
    return KEEP_OPEN;
  });

  add('POST', '/api/ai/jobs/:id/cancel', 'any', (ctx) => {
    jobs.cancel(ctx.params.id!);
    return { ok: true };
  });

  // ---- Voice chat (Codex realtime) ------------------------------------------------
  add('POST', '/api/voice/start', 'any', async (ctx) => {
    const body = await ctx.body<{ sdp: string; voice?: string; chatId?: string }>();
    if (!body.sdp?.startsWith('v=')) throw new HttpError(400, 'sdp (a WebRTC offer) is required');
    try {
      return await voice.start(body);
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  });

  add('GET', '/api/voice/:id/events', 'any', (ctx) => {
    const send = startSse(ctx.res);
    const off = voice.subscribe(ctx.params.id!, (e) => {
      send('voice', e);
      if (e.type === 'closed') setTimeout(() => ctx.res.end(), 50);
    });
    ctx.res.on('close', off);
    return KEEP_OPEN;
  });

  add('POST', '/api/voice/:id/ready', 'any', async (ctx) => {
    await voice.ready(ctx.params.id!);
    return { ok: true };
  });

  add('POST', '/api/voice/:id/stop', 'any', (ctx) => voice.stop(ctx.params.id!));

  // ---- MCP client integrations -------------------------------------------------
  add('GET', '/api/integrations', 'admin', async () => ({
    clients: await integrationStatus(),
    snippets: deps.stdioProxy ? configSnippets(deps.stdioProxy, `http://127.0.0.1:${deps.port()}/mcp`) : null,
    mcpUrl: `http://127.0.0.1:${deps.port()}/mcp`,
  }));

  add('POST', '/api/integrations/:target', 'admin', async (ctx) => {
    const target = ctx.params.target as IntegrationTarget;
    if (target !== 'claude-code' && target !== 'codex') throw new HttpError(400, 'unknown target');
    if (!deps.stdioProxy) throw new HttpError(400, 'This hub has no stdio proxy configured');
    return installIntegration(target, deps.stdioProxy);
  });

  add('DELETE', '/api/integrations/:target', 'admin', async (ctx) => {
    const target = ctx.params.target as IntegrationTarget;
    if (target !== 'claude-code' && target !== 'codex') throw new HttpError(400, 'unknown target');
    return removeIntegration(target);
  });

  // ---- MCP (streamable HTTP, stateless) -------------------------------------------
  const handleMcp = async (ctx: Ctx) => {
    if (ctx.req.method !== 'POST') {
      ctx.res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null }));
      return KEEP_OPEN;
    }
    const raw = await readBody(ctx.req);
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
    const server = createMcpServer(repo, deps.version);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    ctx.res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(ctx.req, ctx.res, parsed);
    return KEEP_OPEN;
  };
  add('POST', '/mcp', 'any', handleMcp);
  add('GET', '/mcp', 'any', handleMcp);
  add('DELETE', '/mcp', 'any', handleMcp);

  // ---- static app ------------------------------------------------------------------
  const serveStatic = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname === '/pair') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pairPage(config.name));
      return;
    }
    if (!deps.webRoot) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Anker hub "${config.name}" is running (v${deps.version}).`);
      return;
    }
    const root = path.resolve(deps.webRoot);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const ext = path.extname(file);
      const immutable = rel.startsWith('/assets/');
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  };

  // ---- dispatcher ------------------------------------------------------------------
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    setCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const isApi = url.pathname.startsWith('/api/') || url.pathname === '/mcp';
    if (!isApi) {
      if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else res.writeHead(405).end();
      return;
    }
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const m = route.pattern.exec(url.pathname)!;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    const auth = authenticate(req, url);
    if (route.auth !== 'none' && !auth) {
      sendJson(res, 401, { error: 'Unauthorized — pair this device first.' });
      return;
    }
    if (route.auth === 'admin' && auth?.kind !== 'admin') {
      sendJson(res, 403, { error: 'Only the hub computer can do this.' });
      return;
    }
    let bodyCache: unknown;
    const ctx: Ctx = {
      req,
      res,
      url,
      params,
      auth,
      body: async <T,>() => {
        if (bodyCache === undefined) {
          const raw = await readBody(req);
          try {
            bodyCache = raw ? JSON.parse(raw) : {};
          } catch {
            throw new HttpError(400, 'Invalid JSON body');
          }
        }
        return bodyCache as T;
      },
    };
    try {
      const out = await route.handler(ctx);
      if (out !== KEEP_OPEN) sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[anker] request failed', req.method, url.pathname, e);
      sendJson(res, status, { error: (e as Error).message ?? 'Internal error' });
    }
  };

  return http.createServer((req, res) => {
    void handler(req, res);
  });
}

const KEEP_OPEN = Symbol('keep-open');
