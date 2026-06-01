// Dynamic lint-staged config: routes each staged file to the right autofix tool
// at commit time instead of hardcoding an extension→tool map that could fall
// out of date. eslint and ember-template-lint cover a small, deliberate set of
// extensions; everything else is handed to prettier IF prettier itself can
// format it — `getFileInfo` is prettier's own source of truth, so new formats
// (or a prettier upgrade that adds one) are picked up automatically with no
// edit here. All routing goes through scripts/lint-autofix.mjs, which applies
// fixes, re-stages, and warns without ever blocking the commit.
import { getFileInfo } from 'prettier';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve .prettierignore next to this config (repo root) rather than relying
// on cwd, so getFileInfo's `ignored` verdict matches what the prettier CLI in
// lint-autofix.mjs actually honors.
const PRETTIER_IGNORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '.prettierignore',
);

// eslint also applies prettier formatting for these via eslint-plugin-prettier,
// so they must go to eslint ONLY (never also to prettier — that would double-
// process and could fight over formatting). Matches what CI's `eslint .` lints.
const ESLINT_EXTENSIONS = new Set(['.js', '.ts', '.gjs', '.gts']);
const TEMPLATE_EXTENSIONS = new Set(['.hbs']);

const AUTOFIX = 'node scripts/lint-autofix.mjs';

// POSIX-safe single-quoting for paths embedded in the returned shell commands
// (staged paths can contain spaces).
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

export default async (stagedFiles) => {
  const eslintFiles = [];
  const templateFiles = [];
  const prettierFiles = [];

  for (const file of stagedFiles) {
    const ext = extname(file);
    if (ESLINT_EXTENSIONS.has(ext)) {
      eslintFiles.push(file);
    } else if (TEMPLATE_EXTENSIONS.has(ext)) {
      templateFiles.push(file);
    } else {
      // Ask prettier whether it can format this file. resolveConfig picks up
      // the repo's .prettierrc (and its plugins) and ignorePath consults
      // .prettierignore, so the decision matches what `prettier --write` would
      // actually do — including skipping ignored files like pnpm-lock.yaml.
      const { inferredParser, ignored } = await getFileInfo(file, {
        resolveConfig: true,
        ignorePath: PRETTIER_IGNORE,
      });
      if (inferredParser && !ignored) prettierFiles.push(file);
    }
  }

  const commands = [];
  if (eslintFiles.length) {
    commands.push(`${AUTOFIX} eslint ${eslintFiles.map(quote).join(' ')}`);
  }
  if (templateFiles.length) {
    commands.push(
      `${AUTOFIX} ember-template-lint ${templateFiles.map(quote).join(' ')}`,
    );
  }
  if (prettierFiles.length) {
    commands.push(`${AUTOFIX} prettier ${prettierFiles.map(quote).join(' ')}`);
  }
  return commands;
};
