// Screenshot an Electron/Chromium page through the DevTools protocol.
// usage: node scripts/cdp-shot.mjs <port> <out.png> [urlSubstring] [js-to-eval-first]
import fs from 'node:fs';
const [port, out, match = '', evalFirst = ''] = process.argv.slice(2);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes(match)) ?? pages.find((p) => p.type === 'page');
if (!page) throw new Error('no page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
if (evalFirst) {
  const r = await send('Runtime.evaluate', { expression: evalFirst, awaitPromise: true, returnByValue: true });
  console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result));
  await new Promise((r) => setTimeout(r, 1200));
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('page:', page.url, '→', out);
ws.close();
