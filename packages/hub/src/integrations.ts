// One-click registration of Anker's MCP server in the user's Claude Code and
// Codex configs, using their own `mcp add` commands. The registered command is
// a tiny stdio proxy that finds the running hub via ~/.anker/connection.json.
import { childEnv, findBinary, runCapture } from './ai/env';

export interface StdioCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type IntegrationTarget = 'claude-code' | 'codex';

export interface IntegrationState {
  target: IntegrationTarget;
  name: string;
  available: boolean;
  registered: boolean;
  detail?: string;
}

const SERVER_NAME = 'anker';

async function cli(target: IntegrationTarget) {
  return findBinary(target === 'claude-code' ? 'claude' : 'codex');
}

export async function integrationStatus(): Promise<IntegrationState[]> {
  const env = await childEnv();
  const out: IntegrationState[] = [];
  for (const target of ['claude-code', 'codex'] as IntegrationTarget[]) {
    const bin = await cli(target);
    const name = target === 'claude-code' ? 'Claude Code' : 'Codex';
    if (!bin) {
      out.push({ target, name, available: false, registered: false });
      continue;
    }
    const r = await runCapture(bin, ['mcp', 'get', SERVER_NAME], { env, timeoutMs: 20_000 });
    const text = `${r.stdout}\n${r.stderr}`;
    const registered = r.code === 0 && !/not found|no mcp server/i.test(text);
    out.push({ target, name, available: true, registered, detail: registered ? text.trim().split('\n').slice(0, 6).join('\n') : undefined });
  }
  return out;
}

export async function installIntegration(target: IntegrationTarget, cmd: StdioCommand): Promise<{ ok: boolean; output: string }> {
  const bin = await cli(target);
  if (!bin) return { ok: false, output: `${target} CLI not found` };
  const env = await childEnv();
  await removeIntegration(target);
  const envArgs = Object.entries(cmd.env).flatMap(([k, v]) => (target === 'claude-code' ? ['-e', `${k}=${v}`] : ['--env', `${k}=${v}`]));
  const args =
    target === 'claude-code'
      ? ['mcp', 'add', '--scope', 'user', SERVER_NAME, ...envArgs, '--', cmd.command, ...cmd.args]
      : ['mcp', 'add', SERVER_NAME, ...envArgs, '--', cmd.command, ...cmd.args];
  const r = await runCapture(bin, args, { env, timeoutMs: 30_000 });
  return { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

export async function removeIntegration(target: IntegrationTarget): Promise<{ ok: boolean; output: string }> {
  const bin = await cli(target);
  if (!bin) return { ok: false, output: 'CLI not found' };
  const env = await childEnv();
  const args = target === 'claude-code' ? ['mcp', 'remove', SERVER_NAME, '--scope', 'user'] : ['mcp', 'remove', SERVER_NAME];
  const r = await runCapture(bin, args, { env, timeoutMs: 20_000 });
  return { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

/** Copy-paste config for other MCP clients (Claude Desktop, Cursor, …). */
export function configSnippets(cmd: StdioCommand, httpUrl: string) {
  const stdio = { command: cmd.command, args: cmd.args, ...(Object.keys(cmd.env).length ? { env: cmd.env } : {}) };
  return {
    stdio,
    claudeDesktop: JSON.stringify({ mcpServers: { anker: stdio } }, null, 2),
    http: { url: httpUrl, note: 'Streamable HTTP. Send "Authorization: Bearer <token>" (token in ~/.anker/connection.json).' },
    claudeCodeCommand: `claude mcp add --scope user anker ${Object.entries(cmd.env)
      .map(([k, v]) => `-e ${k}=${v} `)
      .join('')}-- ${[cmd.command, ...cmd.args].map(shellQuote).join(' ')}`,
    codexCommand: `codex mcp add anker ${Object.entries(cmd.env)
      .map(([k, v]) => `--env ${k}=${v} `)
      .join('')}-- ${[cmd.command, ...cmd.args].map(shellQuote).join(' ')}`,
  };
}

function shellQuote(s: string): string {
  return /^[\w./:=@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
