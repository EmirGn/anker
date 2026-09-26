import { escapeHtml } from '@anker/core';

export const ANDROID_PACKAGE = 'com.emirgn.anker';

/** Landing page for the pairing QR code (opened by the phone's camera). */
export function pairPage(hubName: string): string {
  const name = escapeHtml(hubName);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Pair with Anker</title>
<style>
  :root{color-scheme:light dark;--bg:#f6f3ee;--fg:#1d2230;--muted:#6b7080;--card:#fff;--accent:#d9912b}
  @media (prefers-color-scheme:dark){:root{--bg:#12151c;--fg:#eef0f5;--muted:#9aa0ad;--card:#1b1f29}}
  body{margin:0;font:16px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg);display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
  main{max-width:420px;width:100%;background:var(--card);border-radius:24px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.08);text-align:center}
  h1{font-size:22px;margin:.2em 0}
  p{color:var(--muted);margin:.4em 0 1.2em}
  .code{font:700 40px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;margin:10px 0 18px}
  a.btn{display:block;padding:14px 18px;border-radius:14px;text-decoration:none;font-weight:600;margin:10px 0}
  a.primary{background:var(--accent);color:#1d1406}
  a.ghost{border:1px solid rgba(128,128,128,.35);color:var(--fg)}
  small{color:var(--muted);display:block;margin-top:14px;word-break:break-all}
</style></head>
<body><main>
  <div style="font-size:44px">⚓</div>
  <h1>Pair with ${name}</h1>
  <p>Connect Anker on this device to your hub so your decks and reviews stay in sync.</p>
  <div class="code" id="code">······</div>
  <a class="btn primary" id="open">Open in the Anker app</a>
  <a class="btn ghost" id="web">Use Anker in this browser</a>
  <small id="addr"></small>
</main>
<script>
  const q = new URLSearchParams(location.search);
  const code = (q.get('code') || '').replace(/\\D/g, '');
  const url = location.origin;
  document.getElementById('code').textContent = code || '······';
  document.getElementById('addr').textContent = 'Hub address: ' + url;
  const params = 'url=' + encodeURIComponent(url) + '&code=' + encodeURIComponent(code);
  const isAndroid = /Android/i.test(navigator.userAgent);
  document.getElementById('open').href = isAndroid
    ? 'intent://pair?' + params + '#Intent;scheme=anker;package=${ANDROID_PACKAGE};end'
    : 'anker://pair?' + params;
  document.getElementById('web').href = '/#/connect?' + params;
</script>
</body></html>`;
}
