// Subscription auth is handled entirely by the official CLIs:
//  • Claude: `claude auth login` (Claude Pro/Max via claude.ai), status via `claude auth status`
//  • Codex:  `codex login` (ChatGPT Plus/Pro), status via `codex login status`
// Anker never sees or stores the OAuth tokens — it runs the CLIs headlessly.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AIProvider } from '@anker/core';
import { childEnv, findBinary, runCapture } from './env';

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderStatus {
  id: AIProvider;
  name: string;
  installed: boolean;
  path?: string;
  version?: string;
  loggedIn: boolean;
  account?: string;
  plan?: string;
  detail?: string;
  models: ModelOption[];
  installHint: string;
  loginInProgress?: boolean;
}

const loginProcs = new Map<AIProvider, number>();

/** Claude Code's model aliases always run the newest model of each family. */
const CLAUDE_FAMILIES = [
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'opus', name: 'Opus' },
  { id: 'fable', name: 'Fable' },
  { id: 'haiku', name: 'Haiku', note: 'fastest' },
];

let claudeVersions: { key: string; versions: Promise<Record<string, string>> } | null = null;

/** Newest version per family among the model ids a Claude Code build contains, e.g. { sonnet: '5', opus: '5.5' }. */
function detectClaudeVersions(bin: string): Promise<Record<string, string>> {
  let key: string;
  try {
    const real = fs.realpathSync(bin);
    const st = fs.statSync(real);
    key = `${real}:${st.size}:${st.mtimeMs}`;
    bin = real;
  } catch {
    return Promise.resolve({});
  }
  if (claudeVersions?.key === key) return claudeVersions.versions;
  const versions = new Promise<Record<string, string>>((resolve) => {
    const best: Record<string, [number, number]> = {};
    const re = /claude-(sonnet|opus|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/g;
    let tail = '';
    fs.createReadStream(bin, { highWaterMark: 8 << 20 })
      .on('data', (chunk) => {
        const text = tail + (chunk as Buffer).toString('latin1');
        for (const m of text.matchAll(re)) {
          const v: [number, number] = [Number(m[2]), Number(m[3] ?? 0)];
          const cur = best[m[1]!];
          if (!cur || v[0] > cur[0] || (v[0] === cur[0] && v[1] > cur[1])) best[m[1]!] = v;
        }
        tail = text.slice(-64);
      })
      .on('error', () => resolve({}))
      .on('end', () => resolve(Object.fromEntries(Object.entries(best).map(([f, [a, b]]) => [f, b ? `${a}.${b}` : `${a}`]))));
  });
  claudeVersions = { key, versions };
  return versions;
}

async function claudeModels(bin: string | null): Promise<ModelOption[]> {
  const versions = bin ? await detectClaudeVersions(bin) : {};
  return CLAUDE_FAMILIES.map((f) => ({
    id: f.id,
    label: `${f.name}${versions[f.id] ? ` ${versions[f.id]}` : ''}${f.note ? ` (${f.note})` : ''}`,
  }));
}

/** "GPT-6-Astra" → "GPT-6 Astra" */
const prettyCodex = (name: string) => name.replace(/-(?=[A-Z][a-z])/g, ' ');

function codexModels(): ModelOption[] {
  const out: ModelOption[] = [{ id: '', label: 'Default' }];
  try {
    const home = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const data = JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf8'));
    const list: unknown[] = Array.isArray(data) ? data : (data.models ?? []);
    for (const m of list) {
      const o = m as { slug?: string; display_name?: string; visibility?: string };
      if (o.slug && o.visibility !== 'hide') out.push({ id: o.slug, label: prettyCodex(o.display_name ?? o.slug) });
    }
  } catch {
    // no cache yet — Codex picks its default
  }
  const top = out.find((m) => m.id && m.id === defaultCodexModel());
  if (top) out[0] = { id: '', label: `Default (${top.label})` };
  return out;
}

/** The model Codex lists first for this account (its default when the user's config is ignored). */
export function defaultCodexModel(): string | undefined {
  try {
    const home = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const data = JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf8'));
    const list = (Array.isArray(data) ? data : (data.models ?? [])) as { slug?: string; visibility?: string; priority?: number }[];
    return list
      .filter((m) => m.slug && m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0]?.slug;
  } catch {
    return undefined;
  }
}

async function claudeStatus(): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    id: 'claude',
    name: 'Claude',
    installed: false,
    loggedIn: false,
    models: await claudeModels(null),
    installHint: 'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash',
    loginInProgress: loginProcs.has('claude'),
  };
  const bin = await findBinary('claude');
  if (!bin) return base;
  const env = await childEnv();
  const [ver, auth] = await Promise.all([
    runCapture(bin, ['--version'], { env, timeoutMs: 15_000 }),
    runCapture(bin, ['auth', 'status'], { env, timeoutMs: 20_000 }),
  ]);
  const status: ProviderStatus = { ...base, installed: true, path: bin, version: ver.stdout.trim().split(/\s/)[0], models: await claudeModels(bin) };
  try {
    const j = JSON.parse(auth.stdout);
    status.loggedIn = !!j.loggedIn;
    status.account = j.email;
    status.plan = j.subscriptionType ? `Claude ${String(j.subscriptionType).replace(/^./, (c: string) => c.toUpperCase())}` : j.authMethod;
    if (j.authMethod && j.authMethod !== 'claude.ai') status.detail = `Signed in via ${j.authMethod} (API billing, not your subscription)`;
  } catch {
    status.detail = (auth.stderr || auth.stdout).trim().slice(0, 200) || undefined;
  }
  return status;
}

async function codexStatus(): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    id: 'codex',
    name: 'Codex',
    installed: false,
    loggedIn: false,
    models: codexModels(),
    installHint: 'Install Codex CLI: brew install --cask codex  (or npm i -g @openai/codex)',
    loginInProgress: loginProcs.has('codex'),
  };
  const bin = await findBinary('codex');
  if (!bin) return base;
  const env = await childEnv();
  const [ver, auth] = await Promise.all([
    runCapture(bin, ['--version'], { env, timeoutMs: 15_000 }),
    runCapture(bin, ['login', 'status'], { env, timeoutMs: 20_000 }),
  ]);
  const text = `${auth.stdout}\n${auth.stderr}`.trim();
  const status: ProviderStatus = {
    ...base,
    installed: true,
    path: bin,
    version: ver.stdout.trim().replace(/^codex-cli\s*/, ''),
    loggedIn: auth.code === 0 && /logged in/i.test(text),
  };
  if (/chatgpt/i.test(text)) status.plan = 'ChatGPT subscription';
  else if (/api key/i.test(text)) status.detail = 'Signed in with an API key (billed per token, not your subscription)';
  if (!status.loggedIn) status.detail = text.slice(0, 200) || undefined;
  return status;
}

let cache: { at: number; value: ProviderStatus[] } | null = null;

export async function providerStatuses(force = false): Promise<ProviderStatus[]> {
  if (!force && cache && Date.now() - cache.at < 30_000) {
    return cache.value.map((s) => ({ ...s, loginInProgress: loginProcs.has(s.id) }));
  }
  const value = await Promise.all([claudeStatus(), codexStatus()]);
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateStatus() {
  cache = null;
}

/** Launch the CLI's own browser sign-in. Resolves when the CLI exits. */
export async function startLogin(provider: AIProvider): Promise<{ started: boolean; error?: string }> {
  const bin = await findBinary(provider);
  if (!bin) return { started: false, error: `${provider} CLI is not installed` };
  if (loginProcs.has(provider)) return { started: true };
  const env = await childEnv();
  const args = provider === 'claude' ? ['auth', 'login', '--claudeai'] : ['login'];
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  loginProcs.set(provider, child.pid ?? 0);
  let out = '';
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000);
  child.on('exit', () => {
    clearTimeout(timer);
    loginProcs.delete(provider);
    invalidateStatus();
    if (out.trim()) console.log(`[anker] ${provider} login:`, out.trim().slice(-300));
  });
  child.on('error', () => loginProcs.delete(provider));
  return { started: true };
}

export async function logout(provider: AIProvider) {
  const bin = await findBinary(provider);
  if (!bin) return;
  const env = await childEnv();
  await runCapture(bin, provider === 'claude' ? ['auth', 'logout'] : ['logout'], { env });
  invalidateStatus();
}
