#!/usr/bin/env node
// Generates web/src/iterm-themes.ts from the iTerm2-Color-Schemes GitHub repo.
// Run: node web/scripts/gen-iterm-themes.mjs
import { execSync } from 'child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = '/tmp/iterm2-color-schemes';
const OUT_FILE = join(__dirname, '../src/iterm-themes.ts');

if (!existsSync(REPO_DIR)) {
  console.log('Cloning iTerm2-Color-Schemes...');
  execSync(`git clone --depth 1 https://github.com/mbadolato/iTerm2-Color-Schemes ${REPO_DIR}`, { stdio: 'inherit' });
} else {
  console.log('Using cached repo at', REPO_DIR);
}

/** Parse an .itermcolors plist into a map of color name → {r,g,b} in [0,1]. */
function parsePlist(content) {
  const colors = {};
  // Match each top-level <key>NAME</key><dict>...</dict> block.
  // Inner dicts never contain nested <dict>, so lazy *? is safe.
  const re = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    const body = m[2];
    const comp = (k) => {
      const r = new RegExp(`<key>${k}<\\/key>\\s*<(?:real|integer)>([\\d.e+\\-]+)<\\/(?:real|integer)>`).exec(body);
      return r ? parseFloat(r[1]) : null;
    };
    const r = comp('Red Component');
    const g = comp('Green Component');
    const b = comp('Blue Component');
    if (r !== null && g !== null && b !== null) {
      colors[name] = { r: clamp(r), g: clamp(g), b: clamp(b) };
    }
  }
  return colors;
}

function clamp(v) { return Math.max(0, Math.min(1, v)); }

function hex(c) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function rgba(c, a) {
  return `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${a})`;
}

function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

function mix(c1, c2, t) {
  return { r: c1.r*(1-t)+c2.r*t, g: c1.g*(1-t)+c2.g*t, b: c1.b*(1-t)+c2.b*t };
}

const BLACK = { r: 0, g: 0, b: 0 };

function toTheme(filename, colors) {
  const label = basename(filename, '.itermcolors');
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const get = (k, def) => colors[k] ?? def;

  const bg  = get('Background Color', { r: 0.12, g: 0.12, b: 0.18 });
  const fg  = get('Foreground Color', { r: 0.80, g: 0.80, b: 0.80 });
  const a4  = get('Ansi 4 Color',  { r: 0.2, g: 0.3, b: 0.9 }); // normal blue
  const a8raw = get('Ansi 8 Color', null);
  // Some themes set Ansi 8 = background (invisible). If contrast vs bg is too low, derive instead.
  const a8 = (a8raw && Math.abs(lum(a8raw) - lum(bg)) > 0.08) ? a8raw : mix(fg, bg, 0.45);
  const a9  = get('Ansi 9 Color',  { r: 1.0, g: 0.3, b: 0.3 }); // bright red
  const a10 = get('Ansi 10 Color', { r: 0.3, g: 1.0, b: 0.3 }); // bright green
  const a11 = get('Ansi 11 Color', { r: 1.0, g: 1.0, b: 0.3 }); // bright yellow
  const a12 = get('Ansi 12 Color', { r: 0.3, g: 0.5, b: 1.0 }); // bright blue
  const a13 = get('Ansi 13 Color', { r: 1.0, g: 0.3, b: 1.0 }); // bright magenta
  const a14 = get('Ansi 14 Color', { r: 0.3, g: 1.0, b: 1.0 }); // bright cyan
  const a1  = get('Ansi 1 Color',  { r: 0.8, g: 0.2, b: 0.2 }); // normal red
  const a3  = get('Ansi 3 Color',  { r: 0.8, g: 0.6, b: 0.2 }); // normal yellow

  const isLight = lum(bg) > 0.5;
  const surface  = isLight ? mix(bg, BLACK, 0.05)  : mix(bg, BLACK, 0.15);
  const surface2 = isLight ? mix(bg, BLACK, 0.12)  : mix(bg, BLACK, 0.30);
  const border   = mix(bg, fg, isLight ? 0.12 : 0.15);

  // Selection Color from iTerm2 is the terminal text-selection highlight — a background swatch,
  // not a UI color. It is near-white on many light themes, making it invisible as text or as a
  // button background. Instead:
  //   accent  → Ansi 4 (dark blue, readable as text AND as button bg w/ white fg) on light themes
  //             Ansi 13 (bright magenta, vivid on dark bg) on dark themes
  //   selectionBg → Ansi 12 (bright blue, same vivid base as sha) so it's always visible
  const accent      = isLight ? hex(a4)  : hex(a13);
  const selectionBg = rgba(a12, isLight ? 0.25 : 0.18);

  return {
    name, label, light: isLight,
    bg: hex(bg), surface: hex(surface), surface2: hex(surface2), border: hex(border),
    fg: hex(fg), muted: hex(a8), accent, sha: hex(a12),
    refBg: rgba(a10, 0.18), refFg: hex(a10), selectionBg,
    lanes: [hex(a12), hex(a10), hex(a11), hex(a9), hex(a13), hex(a14), hex(a3), hex(a1)],
    addBg: rgba(a10, 0.13), addFg: hex(a10),
    delBg: rgba(a9, 0.13),  delFg: hex(a9),
    hunk: hex(a14), fhdr: hex(a13),
  };
}

function themeToTs(t) {
  return (
    `  "${t.name}": { name: "${t.name}", label: ${JSON.stringify(t.label)}, light: ${t.light},\n` +
    `    bg: "${t.bg}", surface: "${t.surface}", surface2: "${t.surface2}", border: "${t.border}",\n` +
    `    fg: "${t.fg}", muted: "${t.muted}", accent: "${t.accent}", sha: "${t.sha}",\n` +
    `    refBg: "${t.refBg}", refFg: "${t.refFg}", selectionBg: "${t.selectionBg}",\n` +
    `    lanes: ${JSON.stringify(t.lanes)},\n` +
    `    addBg: "${t.addBg}", addFg: "${t.addFg}",\n` +
    `    delBg: "${t.delBg}", delFg: "${t.delFg}", hunk: "${t.hunk}", fhdr: "${t.fhdr}" },`
  );
}

const schemesDir = join(REPO_DIR, 'schemes');
const files = readdirSync(schemesDir).filter(f => f.endsWith('.itermcolors')).sort();
console.log(`Found ${files.length} scheme files`);

const themes = [];
for (const file of files) {
  try {
    const content = readFileSync(join(schemesDir, file), 'utf8');
    const colors = parsePlist(content);
    themes.push(toTheme(file, colors));
  } catch (err) {
    console.error(`Skipping ${file}: ${err.message}`);
  }
}

// Deduplicate by slug (keep first occurrence)
const seen = new Set();
const unique = themes.filter(t => !seen.has(t.name) && seen.add(t.name));
console.log(`Generated ${unique.length} unique themes`);

const ts = [
  `// AUTO-GENERATED by web/scripts/gen-iterm-themes.mjs — do not edit by hand`,
  `// Source: https://github.com/mbadolato/iTerm2-Color-Schemes`,
  `import type { Theme } from "./themes";`,
  ``,
  `export const ITERM_THEMES: Record<string, Theme> = {`,
  ...unique.map(themeToTs),
  `};`,
  ``,
].join('\n');

writeFileSync(OUT_FILE, ts);
console.log(`Written ${unique.length} themes to ${OUT_FILE}`);
