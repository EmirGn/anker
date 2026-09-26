// Standalone hub: `node dist/cli.cjs [--port 4747] [--data DIR] [--web DIR] [--no-lan]`
// Run it on a Mac mini / Raspberry Pi / VPS to keep sync + AI available 24/7.
import fs from 'node:fs';
import path from 'node:path';
import { startHub } from './index';
import { VERSION } from './version';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Anker hub ${VERSION}
Usage: anker-hub [--port 4747] [--data DIR] [--web DIR] [--no-lan]
  --port   HTTP port (default 4747)
  --data   data directory (default: platform app-data dir, or $ANKER_DATA_DIR)
  --web    directory of the built web app to serve (default: bundled ../app/dist if present)
  --no-lan only listen on 127.0.0.1
  --no-discovery  don't write ~/.anker/connection.json (for tests)`);
    return;
  }
  const candidates = [arg('web'), path.resolve(__dirname, '../../app/dist'), path.resolve(__dirname, 'web')].filter(Boolean) as string[];
  const webRoot = candidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? null;
  const hub = await startHub({
    dataDir: arg('data'),
    port: arg('port') ? Number(arg('port')) : undefined,
    webRoot,
    version: VERSION,
    stdioProxy: { command: process.execPath, args: [path.join(__dirname, 'mcp-stdio.cjs')], env: {} },
    discovery: !process.argv.includes('--no-discovery'),
  });
  if (process.argv.includes('--no-lan')) await hub.setLanEnabled(false);
  console.log(`\n  ⚓ Anker hub ${VERSION} running`);
  if (webRoot) console.log(`  Open on this computer: ${hub.url}/#/connect?token=${hub.token}`);
  console.log(`  MCP endpoint:          ${hub.url}/mcp  (Bearer token in ~/.anker/connection.json)\n`);
  const stop = async () => {
    await hub.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
