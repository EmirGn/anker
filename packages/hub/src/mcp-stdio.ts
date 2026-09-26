// stdio ⇄ HTTP proxy so any MCP client (Claude Code, Codex, Claude Desktop,
// Cursor…) can talk to the running Anker hub. Finds the hub through
// ~/.anker/connection.json (or ANKER_URL / ANKER_TOKEN) and, on macOS, starts
// the Anker app in the background if it isn't running.
import { execFile } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readDiscovery } from './config';
import { MCP_INSTRUCTIONS } from './mcp';
import { VERSION } from './version';

const log = (...a: unknown[]) => console.error('[anker-mcp]', ...a);

function target(): { url: string; token: string } | null {
  if (process.env.ANKER_URL && process.env.ANKER_TOKEN) return { url: process.env.ANKER_URL, token: process.env.ANKER_TOKEN };
  const d = readDiscovery();
  return d ? { url: d.url, token: d.token } : null;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let launched = false;
async function ensureHub(): Promise<{ url: string; token: string }> {
  for (let i = 0; i < 40; i++) {
    const t = target();
    if (t && (await reachable(t.url))) return t;
    if (!launched && process.platform === 'darwin' && !process.env.ANKER_NO_LAUNCH) {
      launched = true;
      log('hub not reachable — starting the Anker app in the background');
      execFile('open', ['-g', '-a', 'Anker'], () => {});
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Anker is not running. Open the Anker app (or run the hub) and try again.');
}

let clientPromise: Promise<Client> | null = null;
function client(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const t = await ensureHub();
      const c = new Client({ name: 'anker-stdio-proxy', version: VERSION });
      await c.connect(
        new StreamableHTTPClientTransport(new URL(`${t.url}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${t.token}` } },
        }),
      );
      return c;
    })().catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

async function main() {
  const server = new Server({ name: 'anker', version: VERSION }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const c = await client();
    return c.listTools();
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const c = await client();
      return (await c.callTool(req.params)) as never;
    } catch (e) {
      clientPromise = null; // reconnect next time (hub may have restarted)
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] } as never;
    }
  });
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  log(e);
  process.exit(1);
});
