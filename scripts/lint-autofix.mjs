#!/usr/bin/env node
// Pre-commit autofix used by lint-staged. Applies auto-fixes to the staged
// files it is given, then re-stages them (lint-staged does the re-stage on a
// zero exit). It NEVER blocks the commit: anything left unfixed is surfaced as
// a warning so the author gets early notice that CI lint will fail, but the
// commit still proceeds. CI lint remains the actual gate.
//
// lint-staged hides the output of tasks that succeed, and this task always
// succeeds (exit 0). So when issues remain we append the linter's diagnostics
// to the file named by $LINT_AUTOFIX_WARN_FILE; the husky pre-commit hook
// prints that file after lint-staged finishes. Without the env var (e.g. run
// by hand) we fall back to writing straight to stderr.
//
// Usage (from lint-staged): node scripts/lint-autofix.mjs <tool> <files...>
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOOLS = {
  eslint: ['eslint', ['--fix', '--no-error-on-unmatched-pattern']],
  'ember-template-lint': ['ember-template-lint', ['--fix']],
  prettier: ['prettier', ['--write']],
};

const [tool, ...files] = process.argv.slice(2);
const spec = TOOLS[tool];
if (!spec) {
  console.error(`lint-autofix: unknown tool "${tool}"`);
  process.exit(0); // never block
}
if (files.length === 0) process.exit(0);

const [bin, baseArgs] = spec;

// Find the nearest ancestor directory that owns a package.json. Tools run from
// there so the per-package binary (e.g. ember-template-lint) and the
// per-package lint config — including the .gts parser override that the root
// config lacks — both resolve correctly.
function packageDirFor(file) {
  let dir = dirname(file);
  while (dir.length > 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const groups = new Map();
for (const file of files) {
  const dir = packageDirFor(file);
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir).push(file);
}

let diagnostics = '';
for (const [cwd, groupFiles] of groups) {
  const result = spawnSync('pnpm', ['exec', bin, ...baseArgs, ...groupFiles], {
    encoding: 'utf8',
    cwd,
  });
  if (result.status !== 0) {
    diagnostics += (result.stdout || '') + (result.stderr || '');
  }
}

if (diagnostics.trim()) {
  const banner =
    `\n⚠️  ${tool}: problems remain after autofix — commit NOT blocked.\n` +
    `   Auto-fixable issues were applied and re-staged. What's left below is not\n` +
    `   auto-fixable; CI lint will fail until you address it.\n\n` +
    diagnostics.trimEnd() +
    '\n';
  const warnFile = process.env.LINT_AUTOFIX_WARN_FILE;
  if (warnFile) {
    appendFileSync(warnFile, banner);
  } else {
    process.stderr.write(banner);
  }
}
process.exit(0); // never block the commit
