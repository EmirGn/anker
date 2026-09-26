// Apps launched from Finder get a minimal PATH, so we ask the user's login
// shell for its PATH once and add the usual install locations of the CLIs.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pathPromise: Promise<string> | null = null;

const EXTRA_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.npm-global', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.volta', 'bin'),
  path.join(os.homedir(), 'Library', 'pnpm'),
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

function shellPath(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve('');
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', 'printf "__ANKER_PATH__%s__END__" "$PATH"'],
      { timeout: 5000, encoding: 'utf8', env: { ...process.env, TERM: 'dumb' } },
      (_err, stdout) => {
        const m = /__ANKER_PATH__(.*?)__END__/s.exec(stdout ?? '');
        resolve(m?.[1] ?? '');
      },
    );
  });
}

export function resolvedPath(): Promise<string> {
  if (!pathPromise) {
    pathPromise = shellPath().then((sp) => {
      const parts = [...sp.split(path.delimiter), ...(process.env.PATH ?? '').split(path.delimiter), ...EXTRA_DIRS];
      return [...new Set(parts.filter(Boolean))].join(path.delimiter);
    });
  }
  return pathPromise;
}

export async function findBinary(name: string): Promise<string | null> {
  const p = await resolvedPath();
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of p.split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        if (fs.statSync(full).isFile()) return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/** Environment for child CLIs: user PATH, no colors, no leaked nested-session variables. */
export async function childEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const nested = !!env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (
      key === 'CLAUDECODE' ||
      key.startsWith('CLAUDE_CODE_') ||
      key.startsWith('CLAUDE_AGENT_SDK') ||
      key === 'CLAUDE_PID' ||
      key === 'CLAUDE_EFFORT' ||
      key.startsWith('CLAUDE_PREVIEW') ||
      key === 'ELECTRON_RUN_AS_NODE' ||
      (nested && key === 'ANTHROPIC_BASE_URL')
    ) {
      delete env[key];
    }
  }
  env.PATH = await resolvedPath();
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.TERM = 'dumb';
  return { ...env, ...extra };
}

export function runCapture(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { env: opts.env, timeout: opts.timeoutMs ?? 20_000, cwd: opts.cwd, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as unknown as { code: number }).code) : err ? 1 : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}
