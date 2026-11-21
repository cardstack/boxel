// Fails when the host's built bundle carries BXL's server-side SQL push-down.
//
// Run after `pnpm build` (CI: test-web-assets.yaml, after the test-assets
// build). That build is `--mode=development`, which keeps declaration names,
// so a module that made it into a chunk is found by the names it declares. A
// minified build renames them, and this check would pass on it whatever it
// held; run it on the development build.
//
// FORBIDDEN names are declared by code nothing in the browser may load: the
// predicate and score compilers and the spreadsheet interpreter
// (`@cardstack/bxl/sql`), which runtime-common's server-only formula-sql.ts
// loads. Browser code checks a query expression lightly; the server provides
// the compiler (runtime-common/query-expression.ts).
//
//   node scripts/check-bundle-server-only.mjs [dist-dir]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN = [
  // the predicate-profile SQL compiler
  'compileBxlPredicateToSql',
  'compileBxlPredicateAstToSql',
  'SQL_PREDICATE_MODULE',
  // the score-profile SQL compiler
  'compileBxlScoreToSql',
  'parseScoreFormula',
  'BXL_SCORE_FUNCTIONS',
  'emptyCallNames',
  // the spreadsheet interpreter
  'prepareSpreadsheetFormula',
];

const args = process.argv.slice(2);
const hostDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = args.find((a) => !a.startsWith('--')) ?? join(hostDir, 'dist');
const assetsDir = join(distDir, 'assets');

if (!existsSync(assetsDir)) {
  console.error(
    `check-bundle-server-only: ${assetsDir} does not exist; build the host first`,
  );
  process.exit(1);
}

const chunks = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (chunks.length === 0) {
  console.error(`check-bundle-server-only: no .js chunks in ${assetsDir}`);
  process.exit(1);
}

let found = new Map();
for (let file of chunks) {
  let code = readFileSync(join(assetsDir, file), 'utf8');
  for (let name of FORBIDDEN) {
    if (new RegExp(`\\b${name}\\b`).test(code)) {
      found.set(name, [...(found.get(name) ?? []), file]);
    }
  }
}

for (let [name, files] of found) {
  console.error(
    `check-bundle-server-only: error: ${name} in ${files.join(', ')}`,
  );
}

if (found.size > 0) {
  console.error(
    'check-bundle-server-only: the host bundle carries BXL SQL push-down. Browser code reaches BXL through `@cardstack/bxl` or `@cardstack/bxl/compiler`; `@cardstack/bxl/sql` is for the server (eslint/bxl-sql-imports.cjs).',
  );
  process.exit(1);
}
console.log(
  `check-bundle-server-only: ok (${chunks.length} chunks; none of ${FORBIDDEN.join(', ')})`,
);
