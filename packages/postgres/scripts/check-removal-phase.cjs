#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

// Guard: a migration added to `migrations/` (the additive phase) must not drop
// or rename a column/table in its `up()`. A destructive change applied during a
// rolling deploy breaks the previous code revision while it is still serving —
// old tasks query a column the migration just removed. Such changes belong in
// `migrations-removal/`, which runs post-deploy once the old tasks have drained.
// See scripts/migrate-local.sh and the migrate-db-remove job in
// .github/workflows/manual-deploy.yml.
//
// Scoped to the migration files passed as arguments (the CI step feeds the
// changed files from determine-changed-migrations.sh), so it only checks newly
// added migrations, not the drops already present in `migrations/`.
//
// AST-based (via the TypeScript parser) rather than grep so it can look ONLY at
// the `up` function: an additive migration's `down()` legitimately calls
// dropColumn/dropTable to reverse itself, and a text search can't tell the two
// apart. Heuristic by design: catches column/table DROP and RENAME (what breaks
// old code mid-rollout), not NOT-NULL tightening, type narrowing, or destructive
// SQL assembled from non-literal strings.

const fs = require('fs');
const path = require('path');

let ts;
try {
  ts = require('typescript');
} catch {
  console.error(
    'check-removal-phase: the `typescript` package is required to parse migrations but could not be resolved.',
  );
  process.exit(1);
}

// pgm builder methods that drop or rename a column/table.
const DESTRUCTIVE_METHODS = new Set([
  'dropColumn',
  'dropColumns',
  'dropTable',
  'renameColumn',
  'renameTable',
]);
// Raw-SQL escape hatch: pgm.sql('... DROP COLUMN ...'), etc.
const DESTRUCTIVE_SQL = /\bdrop\s+(column|table)\b|\brename\s+(column\b|to\b)/i;

// Only guard the additive phase. migrations-removal/ is where drops belong.
const ADDITIVE_DIR = `${path.sep}migrations${path.sep}`;

function findUpFunction(sourceFile) {
  let upFn = null;
  (function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'up'
    ) {
      const obj = node.left.expression;
      const isExports =
        (ts.isIdentifier(obj) && obj.text === 'exports') ||
        (ts.isPropertyAccessExpression(obj) && obj.name.text === 'exports');
      if (
        isExports &&
        (ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right))
      ) {
        upFn = node.right;
      }
    }
    ts.forEachChild(node, visit);
  })(sourceFile);
  return upFn;
}

function destructiveOpsInUp(upFn, sourceFile) {
  const ops = new Set();
  (function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const recv = node.expression.expression;
      const onPgm = ts.isIdentifier(recv) && recv.text === 'pgm';
      const method = node.expression.name.text;
      if (onPgm && DESTRUCTIVE_METHODS.has(method)) {
        ops.add(method);
      }
      if (onPgm && method === 'sql' && node.arguments.length > 0) {
        const arg = node.arguments[0];
        let sqlText = '';
        if (ts.isStringLiteralLike(arg)) {
          sqlText = arg.text;
        } else if (
          ts.isTemplateExpression(arg) ||
          ts.isNoSubstitutionTemplateLiteral(arg)
        ) {
          sqlText = arg.getText(sourceFile);
        }
        if (DESTRUCTIVE_SQL.test(sqlText)) {
          ops.add('sql (DROP/RENAME)');
        }
      }
    }
    ts.forEachChild(node, visit);
  })(upFn.body);
  return [...ops];
}

// Files come from argv (local use) and/or the CHANGED_MIGRATIONS env var (the CI
// step feeds determine-changed-migrations.sh's newline-separated list this way,
// so the workflow doesn't rely on shell word-splitting).
const files = [
  ...process.argv.slice(2),
  ...(process.env.CHANGED_MIGRATIONS || '').split(/\s+/),
]
  .map((f) => f.trim())
  .filter((f) => f && /^\d+_.*\.(js|ts)$/.test(path.basename(f)))
  // Only the additive phase; drops in migrations-removal/ are the whole point.
  .filter((f) => f.includes(ADDITIVE_DIR) && !f.includes('migrations-removal'));

const violations = [];
for (const file of files) {
  if (!fs.existsSync(file)) {
    continue; // renamed/deleted in the diff — nothing to check
  }
  const src = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    // Parse .ts migrations as TypeScript so TS-only syntax doesn't produce a
    // malformed tree that hides a destructive call (createSourceFile doesn't
    // throw on parse errors). Matches the .js|.ts file filter above.
    /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const upFn = findUpFunction(sourceFile);
  if (!upFn) {
    continue;
  }
  const ops = destructiveOpsInUp(upFn, sourceFile);
  if (ops.length) {
    violations.push({ file, ops });
  }
}

if (violations.length) {
  console.error(
    'Destructive DDL found in the up() of an additive migration:\n',
  );
  for (const { file, ops } of violations) {
    console.error(`  ${file}`);
    console.error(`    → ${ops.join(', ')}`);
  }
  console.error(
    '\nColumn/table drops and renames break the previous code revision during a' +
      '\nrolling deploy (old tasks query a column the migration just removed).' +
      '\nMove this migration to packages/postgres/migrations-removal/, which runs' +
      '\npost-deploy once the old tasks have drained:' +
      '\n\n  pnpm --filter @cardstack/postgres migrate:create-removal <name>' +
      '\n\nor `git mv` the file there (it is tracked by filename, so moving a' +
      '\nnot-yet-applied migration is clean).',
  );
  process.exit(1);
}

console.log(
  `check-removal-phase: no destructive DDL in ${files.length} additive migration(s) checked.`,
);
