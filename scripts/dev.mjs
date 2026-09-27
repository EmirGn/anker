// Dev mode: the hub (API + MCP + AI bridge) on :4848 with its own data folder,
// plus the Vite dev server on :5173 pre-connected to it with the admin token.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, '.anker-dev');
execFileSync(process.execPath, ['build.mjs'], { cwd: path.join(root, 'packages/hub'), stdio: 'inherit' });

const hub = spawn(process.execPath, ['packages/hub/dist/cli.cjs', '--port', '4848', '--data', dataDir, '--no-discovery'], { cwd: root, stdio: 'inherit' });
for (let i = 0; i < 100 && !fs.existsSync(path.join(dataDir, 'hub.json')); i++) await new Promise((r) => setTimeout(r, 100));
const token = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub.json'), 'utf8')).adminToken;

const vite = spawn('npx', ['vite'], {
  cwd: path.join(root, 'packages/app'),
  stdio: 'inherit',
  env: { ...process.env, VITE_HUB_URL: 'http://127.0.0.1:4848', VITE_HUB_TOKEN: token },
});

const stop = () => {
  hub.kill();
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
