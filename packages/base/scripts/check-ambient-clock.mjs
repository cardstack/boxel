// Enforces that card code reads the clock through `helpers/clock` rather than
// calling `Date.now()` or `new Date()` directly.
//
// Anything that renders an elapsed time — "3d ago", a countdown, an age, an
// "expires soon" warning — produces different output depending on when it runs,
// so a visual comparison of it differs between two runs over identical data.
// The usual way to quiet that is to stop comparing the element, which trades
// the regression coverage away. Reading through the seam means a test can pin
// the instant instead, and the value stays visible.
//
// The seam falls back to the real clock when nothing has pinned it, so routing
// a call through it changes nothing outside a test.
//
// ESLint would be the natural home for this, but it does not run over this
// package — `lint` here is ember-template-lint plus these scripts — so it
// follows the shape of check-no-isused-option.mjs instead.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'declarations', '__boxel']);
const SOURCE_EXT = /\.(gts|ts|js)$/;
// The seam itself is the one place allowed to read the real clock.
const SEAM = join('helpers', 'clock.ts');

const AMBIENT_CLOCK = /(?<![.\w])(Date\.now\s*\(\s*\)|new\s+Date\s*\(\s*\))/;

// Comments discuss `Date.now()` legitimately — describing where a value came
// from — so they are removed before matching rather than counted. Blanking
// preserves line numbers so a violation still reports where it is.
function stripComments(source) {
  let out = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\{!--[\s\S]*?--\}\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\{![\s\S]*?\}\}/g, (m) => m.replace(/[^\n]/g, ' '));
  return out
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (SOURCE_EXT.test(entry)) {
      yield full;
    }
  }
}

const violations = [];
for (const file of walk(baseDir)) {
  const rel = relative(baseDir, file);
  if (rel === SEAM) continue;
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (AMBIENT_CLOCK.test(line)) {
      violations.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    `Found ${violations.length} direct clock read(s) in @cardstack/base.\n` +
      `Import { now, nowDate } from 'helpers/clock' instead, so a test can pin\n` +
      `the instant and the rendered value stays comparable:\n\n` +
      violations.map((v) => `  ${v}`).join('\n') +
      '\n',
  );
  process.exit(1);
}

console.log('No direct clock reads found in @cardstack/base.');
