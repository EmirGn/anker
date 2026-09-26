// Runs the official Claude Code / Codex CLIs headlessly and normalises their
// JSONL event streams into one small event vocabulary for the UI.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { AIProvider } from '@anker/core';
import { childEnv, findBinary } from './env';

export type AIEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; delta: string }
  | { type: 'message'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; id: string; name: string; input?: unknown; status: 'running' | 'ok' | 'error'; output?: string }
  | { type: 'rate'; utilization?: number; window?: string; resetsAt?: number }
  | { type: 'log'; text: string }
  | DoneEvent;

export interface DoneEvent {
  type: 'done';
  ok: boolean;
  result?: string;
  structured?: unknown;
  error?: string;
  sessionId?: string;
}

export interface RunOptions {
  provider: AIProvider;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  resumeSessionId?: string;
  /** MCP endpoint of this hub; null = no tools */
  mcp?: { url: string; token: string } | null;
  jsonSchema?: Record<string, unknown>;
  workDir: string;
  persistSession: boolean;
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
}

export interface AgentRun {
  cancel(): void;
  done: Promise<DoneEvent>;
}

const TOOL_OUTPUT_MAX = 4000;

function toolOutputText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, TOOL_OUTPUT_MAX);
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('\n')
      .slice(0, TOOL_OUTPUT_MAX);
  }
  if (content && typeof content === 'object' && 'content' in content) return toolOutputText((content as { content: unknown }).content);
  return content == null ? '' : JSON.stringify(content).slice(0, TOOL_OUTPUT_MAX);
}

/** "mcp__anker__add_words" → "add_words" */
export function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
}

export async function runAgent(opts: RunOptions, onEvent: (e: AIEvent) => void): Promise<AgentRun> {
  const bin = await findBinary(opts.provider);
  if (!bin) {
    const done: DoneEvent = {
      type: 'done',
      ok: false,
      error: `The ${opts.provider === 'claude' ? 'Claude Code' : 'Codex'} CLI is not installed on the hub computer.`,
    };
    onEvent(done);
    return { cancel() {}, done: Promise.resolve(done) };
  }
  fs.mkdirSync(opts.workDir, { recursive: true });
  const cleanup: string[] = [];
  const extraEnv: Record<string, string> = {};
  let args: string[];

  if (opts.provider === 'claude') {
    args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--setting-sources',
      'project',
      '--disable-slash-commands',
      '--strict-mcp-config',
    ];
    if (opts.mcp) {
      const file = path.join(opts.workDir, `mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({
          mcpServers: {
            anker: { type: 'http', url: opts.mcp.url, headers: { Authorization: `Bearer ${opts.mcp.token}` } },
          },
        }),
        { mode: 0o600 },
      );
      cleanup.push(file);
      args.push('--mcp-config', file, '--allowedTools', 'mcp__anker');
    }
    // No built-in tools (shell, files, web): the agent can only touch Anker.
    args.push('--tools', '');
    if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (!opts.persistSession) args.push('--no-session-persistence');
    if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema));
  } else {
    args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'read-only', '-C', opts.workDir];
    if (opts.systemPrompt) args.push('-c', `developer_instructions=${JSON.stringify(opts.systemPrompt)}`);
    if (opts.mcp) {
      args.push(
        '-c',
        `mcp_servers.anker.url=${JSON.stringify(opts.mcp.url)}`,
        '-c',
        'mcp_servers.anker.bearer_token_env_var="ANKER_MCP_TOKEN"',
        '-c',
        'mcp_servers.anker.tool_timeout_sec=120',
        // Headless runs can't answer approval prompts; Anker's own tools are trusted.
        '-c',
        'mcp_servers.anker.default_tools_approval_mode="approve"',
      );
      extraEnv.ANKER_MCP_TOKEN = opts.mcp.token;
    }
    if (opts.model) args.push('-m', opts.model);
    if (opts.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(opts.effort)}`);
    if (!opts.persistSession) args.push('--ephemeral');
    if (opts.jsonSchema) {
      const file = path.join(opts.workDir, `schema-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(opts.jsonSchema));
      cleanup.push(file);
      args.push('--output-schema', file);
    }
    if (opts.resumeSessionId) args.push('resume', opts.resumeSessionId);
    args.push('-');
  }

  const env = await childEnv(extraEnv);
  const child = spawn(bin, args, { cwd: opts.workDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  child.stdin.end(opts.prompt);

  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });

  let sessionId = opts.resumeSessionId;
  let final: DoneEvent | null = null;
  let lastMessage = '';
  let cancelled = false;
  const toolNames = new Map<string, string>();
  // Codex numbers items per turn (item_1, item_2…), so namespace them per run.
  const runTag = Math.random().toString(36).slice(2, 8);

  const emit = (e: AIEvent) => {
    try {
      onEvent(e);
    } catch (err) {
      console.error('[anker] AI event handler failed', err);
    }
  };

  const handleClaude = (o: Record<string, any>) => {
    switch (o.type) {
      case 'system':
        if (o.subtype === 'init') {
          if (o.session_id) {
            sessionId = o.session_id;
            emit({ type: 'session', sessionId: o.session_id });
          }
          const anker = (o.mcp_servers ?? []).find((s: { name: string }) => s.name === 'anker');
          if (opts.mcp && anker && anker.status !== 'connected') emit({ type: 'log', text: `Anker tools: ${anker.status}` });
        }
        break;
      case 'stream_event': {
        const ev = o.event ?? {};
        if (o.parent_tool_use_id) break;
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          emit({ type: 'text', delta: ev.delta.text });
        } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
          emit({ type: 'thinking' });
        }
        break;
      }
      case 'assistant': {
        if (o.parent_tool_use_id) break;
        for (const block of o.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            lastMessage = block.text;
            emit({ type: 'message', text: block.text });
          } else if (block.type === 'tool_use') {
            toolNames.set(block.id, block.name);
            if (block.name === 'StructuredOutput') break;
            emit({ type: 'tool', id: block.id, name: shortToolName(block.name), input: block.input, status: 'running' });
          }
        }
        break;
      }
      case 'user': {
        const content = o.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const name = toolNames.get(block.tool_use_id) ?? 'tool';
          if (name === 'StructuredOutput') continue;
          emit({
            type: 'tool',
            id: block.tool_use_id,
            name: shortToolName(name),
            status: block.is_error ? 'error' : 'ok',
            output: toolOutputText(block.content),
          });
        }
        break;
      }
      case 'rate_limit_event': {
        const info = o.rate_limit_info ?? {};
        const w = info.unifiedWindows?.five_hour;
        emit({ type: 'rate', utilization: w?.utilization, window: info.rateLimitType, resetsAt: info.resetsAt });
        break;
      }
      case 'result':
        final = {
          type: 'done',
          ok: !o.is_error && o.subtype === 'success',
          result: typeof o.result === 'string' ? o.result : lastMessage,
          structured: o.structured_output,
          error: o.is_error ? String(o.result ?? o.subtype ?? 'error') : undefined,
          sessionId: o.session_id ?? sessionId,
        };
        break;
    }
  };

  const handleCodex = (o: Record<string, any>) => {
    switch (o.type) {
      case 'thread.started':
        sessionId = o.thread_id;
        emit({ type: 'session', sessionId: o.thread_id });
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const it = o.item ?? {};
        const completed = o.type === 'item.completed';
        if (it.type === 'agent_message' && completed && it.text) {
          lastMessage = it.text;
          emit({ type: 'message', text: it.text });
        } else if (it.type === 'reasoning' && o.type === 'item.started') {
          emit({ type: 'thinking' });
        } else if (it.type === 'mcp_tool_call') {
          const failed = it.status === 'failed' || !!it.error;
          emit({
            type: 'tool',
            id: `${runTag}:${it.id}`,
            name: it.tool ?? 'tool',
            input: it.arguments,
            status: completed ? (failed ? 'error' : 'ok') : 'running',
            output: completed ? toolOutputText(it.error?.message ?? it.result?.content ?? it.result) : undefined,
          });
        } else if (it.type === 'command_execution') {
          emit({
            type: 'tool',
            id: `${runTag}:${it.id}`,
            name: 'shell',
            input: { command: it.command },
            status: completed ? (it.exit_code === 0 ? 'ok' : 'error') : 'running',
            output: completed ? String(it.aggregated_output ?? '').slice(0, TOOL_OUTPUT_MAX) : undefined,
          });
        } else if (it.type === 'error' && completed && it.message) {
          emit({ type: 'log', text: it.message });
        }
        break;
      }
      case 'turn.failed':
        final = { type: 'done', ok: false, error: extractCodexError(o.error?.message), sessionId };
        break;
      case 'error':
        emit({ type: 'log', text: extractCodexError(o.message) });
        break;
    }
  };

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const t = line.trim();
    if (!t.startsWith('{')) return;
    let o: Record<string, any>;
    try {
      o = JSON.parse(t);
    } catch {
      return;
    }
    if (opts.provider === 'claude') handleClaude(o);
    else handleCodex(o);
  });

  const timer = setTimeout(() => {
    cancelled = true;
    child.kill('SIGTERM');
  }, opts.timeoutMs ?? 10 * 60_000);

  const done = new Promise<DoneEvent>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(timer);
      for (const f of cleanup) fs.rmSync(f, { force: true });
      let result: DoneEvent;
      if (final) {
        result = final;
      } else if (cancelled) {
        result = { type: 'done', ok: false, error: 'Cancelled', sessionId };
      } else if (code === 0) {
        result = { type: 'done', ok: true, result: lastMessage, sessionId };
      } else {
        result = { type: 'done', ok: false, error: summarizeStderr(stderr) || `${opts.provider} exited with code ${code}`, sessionId };
      }
      if (result.ok && opts.jsonSchema && result.structured === undefined && result.result) {
        result.structured = parseJsonLoose(result.result);
      }
      if (!result.sessionId) result.sessionId = sessionId;
      emit(result);
      resolve(result);
    };
    child.on('error', (err) => {
      final = final ?? { type: 'done', ok: false, error: err.message, sessionId };
    });
    child.on('close', (code) => {
      rl.close();
      finish(code);
    });
  });

  return {
    cancel() {
      cancelled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    },
    done,
  };
}

function extractCodexError(msg: unknown): string {
  const s = String(msg ?? 'Unknown error');
  try {
    const j = JSON.parse(s);
    return j?.error?.message ?? j?.message ?? s;
  } catch {
    return s;
  }
}

function summarizeStderr(s: string): string {
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Reading (additional )?(prompt|input) from stdin/i.test(l));
  return lines.slice(-4).join('\n').slice(0, 600);
}

export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
