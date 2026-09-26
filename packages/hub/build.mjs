import { build } from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'warning',
  define: { __ANKER_VERSION__: JSON.stringify(pkg.version) },
  minify: false,
};

await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.cjs', banner: { js: '#!/usr/bin/env node' } });
await build({ ...common, entryPoints: ['src/mcp-stdio.ts'], outfile: 'dist/mcp-stdio.cjs' });
console.log('hub built → dist/cli.cjs, dist/mcp-stdio.cjs');
