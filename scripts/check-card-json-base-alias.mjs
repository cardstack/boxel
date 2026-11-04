#!/usr/bin/env node
// Fails when a realm's JSON spells the base realm as its
// `https://cardstack.com/base/` alias. ADR 002 §1.4 has card JSON name a
// well-known realm by its prefix, so `adoptsFrom.module`, Spec `ref.module`,
// links and `realm.json` read `@cardstack/base/…`. The ESLint rule
// `no-url-form-base-imports` covers a realm's `.gts` and `.ts` source; this
// check covers its JSON, which ESLint doesn't parse.
//
// Usage: check-card-json-base-alias.mjs [--ignore <path>]... <realm-dir>...
//
// `tsconfig.json` is skipped wherever it appears, because §1.4 allows the alias
// in its `paths`. `--ignore` takes a path relative to the realm directory and
// skips everything under it, for content kept byte-for-byte that the runtime
// never resolves as an identifier, such as pinned sample files.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

const ALIAS = 'https://cardstack.com/base/';
const SKIP_DIRS = new Set(['node_modules']);
const SKIP_FILES = new Set(['tsconfig.json']);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ignore: { type: 'string', multiple: true, default: [] } },
});
if (positionals.length === 0) {
  console.error(
    'Usage: check-card-json-base-alias.mjs [--ignore <path>]... <realm-dir>...',
  );
  process.exit(2);
}

function* walk(dir, isIgnored) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (isIgnored(full)) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(full, isIgnored);
      }
    } else if (entry.name.endsWith('.json') && !SKIP_FILES.has(entry.name)) {
      yield full;
    }
  }
}

const violations = [];
let fileCount = 0;
for (const realmDir of positionals) {
  const ignored = values.ignore.map((path) =>
    join(realmDir, path).replace(/[\\/]+$/, ''),
  );
  const isIgnored = (full) =>
    ignored.some((path) => full === path || full.startsWith(path + sep));
  for (const file of walk(realmDir, isIgnored)) {
    fileCount++;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.includes(ALIAS)) {
          violations.push(`${relative('.', file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
}

if (violations.length > 0) {
  console.error(
    `Name the base realm by its \`@cardstack/base/\` prefix, not the \`${ALIAS}\` alias (ADR 002 §1.4):\n` +
      violations.map((v) => `  ${v}`).join('\n'),
  );
  process.exit(1);
}
console.log(`ok: no ${ALIAS} alias in ${fileCount} JSON files`);
