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

const CLAUDE_MODELS: ModelOption[] = [
  { id: '', label: 'Default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku (fastest)' },
  { id: 'fable', label: 'Fable' },
];

function codexModels(): ModelOption[] {
  const out: ModelOption[] = [{ id: '', label: 'Default' }];
  try {
    const home = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const data = JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf8'));
    const list: unknown[] = Array.isArray(data) ? data : (data.models ?? []);
    for (const m of list) {
      const o = m as { slug?: string; display_name?: string; visibility?: string };
      if (o.slug && o.visibility !== 'hide') out.push({ id: o.slug, label: o.display_name ?? o.slug });
    }
  } catch {
    // no cache yet — Codex picks its default
  }
  return out;
}

async function claudeStatus(): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    id: 'claude',
    name: 'Claude',
    installed: false,
    loggedIn: false,
    models: CLAUDE_MODELS,
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
  const status: ProviderStatus = { ...base, installed: true, path: bin, version: ver.stdout.trim().split(/\s/)[0] };
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
