/**
 * One-shot generator for the PWA icon set — Palette C "Midnight Gethsemane".
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 *
 * Renders a single safe-zone-aware SVG (deep royal lapis canvas #0A1118 with
 * a living ember #F59E0B cross) into every PNG the manifest and Apple meta
 * tags reference. Uses `sharp`, which is already present as a transitive
 * dependency of next/image — no new packages are installed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(rootDir, 'public', 'icons');

/** Icon mark kept inside the maskable safe zone (inner ~80% of the canvas). */
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="ember-glow" cx="256" cy="248" r="236" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#F59E0B" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#F59E0B" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#0A1118"/>
  <circle cx="256" cy="248" r="236" fill="url(#ember-glow)"/>
  <g fill="#F59E0B">
    <rect x="233" y="118" width="46" height="282" rx="23"/>
    <rect x="148" y="188" width="216" height="46" rx="23"/>
  </g>
  <circle cx="256" cy="188" r="12" fill="#FBBF24"/>
</svg>`;

const OUTPUTS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

const sharpModule = await import('sharp').catch(() => null);
if (!sharpModule) {
  console.error(
    'sharp is unavailable. Install it (or run inside node_modules where next provides it) and retry.',
  );
  process.exit(1);
}
const sharp = sharpModule.default;

mkdirSync(iconsDir, { recursive: true });
writeFileSync(path.join(iconsDir, 'icon.svg'), `${ICON_SVG}\n`, 'utf8');

await Promise.all(
  OUTPUTS.map(async ({ file, size }) => {
    await sharp(Buffer.from(ICON_SVG))
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, file));
    console.log(`Generated public/icons/${file} (${size}x${size})`);
  }),
);