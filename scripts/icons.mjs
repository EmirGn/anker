// Renders every app icon from one SVG design (run: node scripts/icons.mjs)
// The brand mark is Otto, the lilac octopus with the golden anchor, on krake-soft.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = (...p) => path.join(root, ...p);

const KRAKE_SOFT = '#efeaff';
const PAPER = '#fbf6ee';
const PAPER_DARK = '#16140f';

// Same drawing as packages/app/src/components/Otto.tsx (mood: happy). Art centre ≈ (117, 108).
const OTTO = `
  <g stroke="#a895ec" stroke-width="14" fill="none" stroke-linecap="round">
    <path d="M64 116 Q48 144 60 172"/><path d="M86 120 Q76 152 90 180"/><path d="M114 120 Q124 152 110 180"/><path d="M136 116 Q160 136 164 120"/>
  </g>
  <path d="M48 124 Q48 36 100 36 Q152 36 152 124 Z" fill="#b9a7f2"/>
  <path d="M60 70 Q70 48 92 44" stroke="#d8ceff" stroke-width="8" fill="none" stroke-linecap="round"/>
  <g stroke="#1b1e24" stroke-width="4.5" fill="none" stroke-linecap="round"><path d="M77 91 Q84 81 91 91"/><path d="M109 91 Q116 81 123 91"/></g>
  <circle cx="70" cy="104" r="7" fill="#f2b3b3"/><circle cx="130" cy="104" r="7" fill="#f2b3b3"/>
  <path d="M88 101 Q100 119 112 101 Q100 107 88 101Z" fill="#1b1e24"/>
  <g stroke="#e0a800" stroke-width="5" fill="none" stroke-linecap="round"><circle cx="176" cy="96" r="5"/><path d="M176 102 V132 M166 110 H186 M162 124 Q176 140 190 124"/></g>`;

// Monochrome anchor for the macOS menu-bar template image (Otto doesn't read at 22 px).
const ANCHOR = `
  <circle cx="32" cy="12.5" r="5.5"/>
  <path d="M32 18v35"/>
  <path d="M21 27h22"/>
  <path d="M12.5 37c1.8 10 10 16 19.5 16s17.7-6 19.5-16"/>
  <path d="M8.5 40.5 12.5 35l5 4"/>
  <path d="M55.5 40.5 51.5 35l-5 4"/>`;

/** size: canvas; tile: rounded-rect size (0 = full bleed); otto: Otto's width as a share of the tile. */
function icon({ size = 1024, tile = 824, radius = 185, otto = 0.74, bg = KRAKE_SOFT }) {
  const t = tile || size;
  const o = (size - t) / 2;
  const s = (t * otto) / 152;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect x="${o}" y="${o}" width="${t}" height="${t}" rx="${tile ? radius * (t / 824) : 0}" fill="${bg}"/>` : ''}
  <g transform="translate(${size / 2} ${size / 2}) scale(${s}) translate(-117 -108)">${OTTO}</g>
</svg>`;
}

const png = (s, file, size) => sharp(Buffer.from(s)).resize(size, size).png().toFile(file);

fs.mkdirSync(out('assets'), { recursive: true });
fs.mkdirSync(out('packages/desktop/build'), { recursive: true });
fs.mkdirSync(out('packages/app/public'), { recursive: true });

// macOS: Big Sur style tile with transparent margin
await png(icon({}), out('packages/desktop/build/icon.png'), 1024);
// Tray (template image: black glyph on transparent, macOS tints it)
const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g transform="translate(32 32) scale(0.86) translate(-32 -31)" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${ANCHOR}</g></svg>`;
await png(tray, out('packages/desktop/build/trayTemplate.png'), 22);
await png(tray, out('packages/desktop/build/trayTemplate@2x.png'), 44);
// Web / PWA
fs.writeFileSync(out('packages/app/public/icon.svg'), icon({ size: 512, tile: 512, radius: 115 }));
await png(icon({ size: 1024, tile: 1024, radius: 0, otto: 0.7 }), out('packages/app/public/icon-512.png'), 512);
await png(icon({ size: 1024, tile: 1024, radius: 0, otto: 0.7 }), out('packages/app/public/icon-192.png'), 192);
// Android (for @capacitor/assets): full-bleed icon + adaptive layers + splash
await png(icon({ size: 1024, tile: 0, otto: 0.7 }), out('assets/icon-only.png'), 1024);
await png(icon({ size: 1024, tile: 0, otto: 0.5, bg: null }), out('assets/icon-foreground.png'), 1024);
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${KRAKE_SOFT}"/></svg>`)).png().toFile(out('assets/icon-background.png'));
const splash = (dark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732"><rect width="2732" height="2732" fill="${dark ? PAPER_DARK : PAPER}"/>
  <g transform="translate(1366 1366) scale(4.2) translate(-117 -108)">${OTTO}</g></svg>`;
await sharp(Buffer.from(splash(false))).png().toFile(out('assets/splash.png'));
await sharp(Buffer.from(splash(true))).png().toFile(out('assets/splash-dark.png'));
console.log('icons written');
