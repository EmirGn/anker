// Renders every app icon from one SVG design (run: node scripts/icons.mjs)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = (...p) => path.join(root, ...p);

const ANCHOR = `
  <circle cx="32" cy="12.5" r="5.5"/>
  <path d="M32 18v35"/>
  <path d="M21 27h22"/>
  <path d="M12.5 37c1.8 10 10 16 19.5 16s17.7-6 19.5-16"/>
  <path d="M8.5 40.5 12.5 35l5 4"/>
  <path d="M55.5 40.5 51.5 35l-5 4"/>`;

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f3c5c"/>
      <stop offset="1" stop-color="#121827"/>
    </linearGradient>
    <linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="58">
      <stop offset="0" stop-color="#ffd98f"/>
      <stop offset="1" stop-color="#e3972c"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="1.6" stdDeviation="1.6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>`;

/** size: canvas; tile: rounded-rect size (0 = full bleed, no tile); scale: anchor scale factor */
function svg({ size = 1024, tile = 824, radius = 185, anchor = 0.62, bg = true, card = true, color = 'url(#gold)', stroke = 5.2 }) {
  const t = tile || size;
  const o = (size - t) / 2;
  const s = (t * anchor) / 64;
  const cx = size / 2;
  const cy = size / 2 + t * 0.012;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${defs}
  ${bg ? `<rect x="${o}" y="${o}" width="${t}" height="${t}" rx="${tile ? radius * (t / 824) : 0}" fill="url(#bg)"/>` : ''}
  ${bg && card ? `<rect x="${cx - t * 0.26}" y="${cy - t * 0.34}" width="${t * 0.52}" height="${t * 0.68}" rx="${t * 0.07}" fill="#ffffff" fill-opacity="0.07" transform="rotate(-9 ${cx} ${cy})"/>` : ''}
  <g transform="translate(${cx} ${cy}) scale(${s}) translate(-32 -31)" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${bg ? 'filter="url(#shadow)"' : ''}>${ANCHOR}</g>
</svg>`;
}

const png = (s, file, size) => sharp(Buffer.from(s)).resize(size, size).png().toFile(file);

fs.mkdirSync(out('assets'), { recursive: true });
fs.mkdirSync(out('packages/desktop/build'), { recursive: true });
fs.mkdirSync(out('packages/app/public'), { recursive: true });

// macOS: Big Sur style tile with transparent margin
await png(svg({}), out('packages/desktop/build/icon.png'), 1024);
// Tray (template image: black glyph on transparent, macOS tints it)
const tray = svg({ size: 64, tile: 64, anchor: 0.86, bg: false, color: '#000', stroke: 6 });
await png(tray, out('packages/desktop/build/trayTemplate.png'), 22);
await png(tray, out('packages/desktop/build/trayTemplate@2x.png'), 44);
// Web / PWA
fs.writeFileSync(out('packages/app/public/icon.svg'), svg({ size: 512, tile: 512, radius: 115, anchor: 0.6 }));
await png(svg({ size: 1024, tile: 1024, radius: 0, anchor: 0.58 }), out('packages/app/public/icon-512.png'), 512);
await png(svg({ size: 1024, tile: 1024, radius: 0, anchor: 0.58 }), out('packages/app/public/icon-192.png'), 192);
// Android (for @capacitor/assets): full-bleed icon + adaptive layers + splash
await png(svg({ size: 1024, tile: 0, anchor: 0.58 }), out('assets/icon-only.png'), 1024);
await png(svg({ size: 1024, tile: 0, anchor: 0.42, bg: false }), out('assets/icon-foreground.png'), 1024);
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${defs}<rect width="1024" height="1024" fill="url(#bg)"/></svg>`)).png().toFile(out('assets/icon-background.png'));
const splash = (dark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732">${defs}<rect width="2732" height="2732" fill="${dark ? '#0e1116' : '#f6f3ee'}"/>
  <g transform="translate(1366 1320) scale(11) translate(-32 -31)" fill="none" stroke="url(#gold)" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round">${ANCHOR}</g></svg>`;
await sharp(Buffer.from(splash(false))).png().toFile(out('assets/splash.png'));
await sharp(Buffer.from(splash(true))).png().toFile(out('assets/splash-dark.png'));
console.log('icons written');
