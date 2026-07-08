// Enforces that the `isUsed` field option is not used in the base card API.
// Which links a search doc follows is expressed through the `searchable` field
// option; there is no per-field flag that forces a link into the doc.
//
// The type system rejects the option in typed code elsewhere, so this check
// covers the base package where the option would be declared — a hit here is the
// earliest signal it has crept in.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'declarations', '__boxel']);
const SOURCE_EXT = /\.(gts|ts|js)$/;

// Matched only in its field-option shape (`isUsed:` as an object-literal key),
// never a `.isUsed` property access or a field named `isUsed`.
const ISUSED_OPTION = /(?<![.\w])isUsed\s*:/;

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
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ISUSED_OPTION.test(line)) {
      violations.push(`${relative(baseDir, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    'Disallowed `isUsed` field option found — use the `searchable` field option instead:\n' +
      violations.map((v) => `  ${v}`).join('\n'),
  );
  process.exit(1);
}
console.log('ok: no isUsed field option in base');
