import type { Linter } from 'eslint';
import Module from 'node:module';
import { delimiter, extname, resolve, sep } from 'node:path';

import type { Task } from './index.ts';

import { jobIdentity } from '../index.ts';

import { resolvePrettierConfig } from '../prettier-config.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LintMessageSource = 'eslint' | 'template-lint';

export interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2; // ESLint convention: 1=warning, 2=error
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  /** Which engine produced this finding. Optional for backwards compat. */
  source?: LintMessageSource;
}

export interface LintArgs {
  source: string;
  filename?: string;
}

export interface LintResult {
  output: string;
  fixed: boolean;
  messages: LintMessage[];
  /** True iff `messages` contains no error-severity entries. Optional for
   * backwards compat — callers can also compute from `messages`. */
  passed?: boolean;
}

// No coalesce handler: each lint enqueue carries its own `source` (the file
// the user is editing) and the caller awaits a result derived from THAT
// source. Two concurrent lint requests across instances are for distinct
// sources; coalescing would return one caller's lint output to a different
// caller. The work is also short and bucketed across 10 random concurrency
// groups, so duplicate-instance contention is negligible.

// ---------------------------------------------------------------------------
// Input bounds
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Host config — single source of truth shared with `pnpm run lint`
// ---------------------------------------------------------------------------

// runtime-common lives at <repo>/packages/runtime-common; host is its sibling.
const HOST_PKG = resolve(__dirname, '..', '..', 'host');
const HOST_ESLINTRC = resolve(HOST_PKG, '.eslintrc.js');
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const LINT_ANCHOR = resolve(HOST_PKG, '__realm__');

// pnpm doesn't hoist transitive deps, so parsers/plugins host references by
// string (e.g. `parser: 'ember-eslint-parser'`) won't resolve from here.
// Mirror pnpm's own eslint bin shim: add .pnpm/node_modules to NODE_PATH.
let nodePathReady = false;
function ensurePnpmNodePath() {
  if (nodePathReady) return;
  const pnpmNodeModules = resolve(
    REPO_ROOT,
    'node_modules',
    '.pnpm',
    'node_modules',
  );
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${pnpmNodeModules}${delimiter}${process.env.NODE_PATH}`
    : pnpmNodeModules;
  // _initPaths is a private but stable Node API used by the official
  // pnpm shim. It re-reads NODE_PATH into Module.globalPaths.
  (Module as unknown as { _initPaths(): void })._initPaths();
  nodePathReady = true;
}

// ---------------------------------------------------------------------------
// Engine caches — config resolution + plugin loading is heavy and never
// changes at runtime, so we instantiate once per worker process.
// ---------------------------------------------------------------------------

let eslintPromise: Promise<any> | undefined;
async function getESLint(): Promise<any> {
  if (eslintPromise) return eslintPromise;
  eslintPromise = initESLint();
  return eslintPromise;
}

async function initESLint(): Promise<any> {
  ensurePnpmNodePath();
  // Load ESLint from host's own node_modules so plugin/parser resolution
  // inside ESLint follows host's dependency tree.
  const hostRequire = Module.createRequire(resolve(HOST_PKG, 'package.json'));
  const { ESLint } = hostRequire('eslint');

  const importMappingConfig = await import(
    // @ts-ignore no types for the import-mapping config
    /* webpackIgnore: true */ '../etc/eslint/missing-card-api-import-config.js'
  );
  const importMappings = (importMappingConfig.default ?? importMappingConfig)
    .importMappings;

  return new ESLint({
    cwd: HOST_PKG,
    overrideConfigFile: HOST_ESLINTRC,
    fix: true,
    // Submission/realm files are in-memory; don't apply host's .eslintignore
    // to them.
    ignore: false,
    overrideConfig: {
      plugins: ['@cardstack/boxel'],
      rules: {
        // Prettier runs as a separate pass after ESLint (see lintOne); folding
        // it in lets the prettier plugin see a mid-fix file (e.g. a not-yet-
        // deduped duplicate import) and throw.
        'prettier/prettier': 'off',
        // Realm files are flat, not laid out like host's tree, so this rule
        // misreads a realm test file (foo.test.gts, no tests/ dir) as
        // production code and rejects its legitimate test-support imports.
        'ember/no-test-support-import': 'off',
        // Realm-submission autofixes host/.eslintrc.js omits (host source
        // authors its own imports; realm content gets them injected).
        '@cardstack/boxel/missing-card-api-import': [
          'error',
          { importMappings },
        ],
        '@cardstack/boxel/no-duplicate-imports': 'error',
        '@cardstack/boxel/no-css-position-fixed': 'warn',
        '@cardstack/boxel/no-forbidden-head-tags': 'warn',
        '@cardstack/boxel/no-literal-realm-urls': 'error',
      },
    },
  });
}

let templateLinterPromise: Promise<any> | undefined;
async function getTemplateLinter(): Promise<any> {
  if (templateLinterPromise) return templateLinterPromise;
  templateLinterPromise = initTemplateLinter();
  return templateLinterPromise;
}

async function initTemplateLinter(): Promise<any> {
  ensurePnpmNodePath();
  const hostRequire = Module.createRequire(resolve(HOST_PKG, 'package.json'));
  const tlModule = hostRequire('ember-template-lint');
  const TemplateLinter = (tlModule as any).default ?? tlModule;
  return new TemplateLinter({ workingDir: HOST_PKG });
}

// ---------------------------------------------------------------------------
// File-extension routing
// ---------------------------------------------------------------------------

const ESLINT_EXTENSIONS = new Set(['.js', '.ts', '.gjs', '.gts']);
const TEMPLATE_LINT_EXTENSIONS = new Set(['.hbs', '.gts', '.gjs']);

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export const lintSource: Task<LintArgs, LintResult> = ({ reportStatus, log }) =>
  async function (args) {
    const { jobInfo } = args as LintArgs & { jobInfo?: unknown };
    const filename = args.filename || 'input.gts';
    log.debug(
      `${jobIdentity(jobInfo as any)} starting lint-source for ${filename}`,
    );
    reportStatus(jobInfo as any, 'start');

    const validated = validateArgs(args);
    const result = validated.ok
      ? await lintOne(args.source, validated.filename)
      : {
          passed: false,
          output: typeof args?.source === 'string' ? args.source : '',
          fixed: false,
          messages: [
            {
              ruleId: null,
              severity: 2 as const,
              message: validated.problem,
              line: 1,
              column: 1,
            },
          ],
        };

    log.debug(
      `${jobIdentity(jobInfo as any)} completed lint-source: ${result.messages.length} message(s), fixed=${result.fixed}`,
    );
    reportStatus(jobInfo as any, 'finish');
    return result;
  };

function validateArgs(
  args: LintArgs,
): { ok: true; filename: string } | { ok: false; problem: string } {
  if (typeof (globalThis as any).document !== 'undefined') {
    return {
      ok: false,
      problem: 'Linting is not supported in the browser environment.',
    };
  }
  if (typeof args?.source !== 'string') {
    return { ok: false, problem: 'lint-source: `source` must be a string' };
  }
  if (Buffer.byteLength(args.source, 'utf8') > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      problem: `lint-source: source exceeds ${MAX_FILE_SIZE_BYTES} bytes`,
    };
  }
  // X-Filename is user input; absolute paths and `..` traversal land here.
  const normalized = (args.filename || 'input.gts').replace(/\\/g, '/');
  const resolved = resolve(LINT_ANCHOR, normalized);
  if (!resolved.startsWith(LINT_ANCHOR + sep)) {
    return {
      ok: false,
      problem: `lint-source: invalid filename ${JSON.stringify(args.filename)}`,
    };
  }
  return { ok: true, filename: normalized };
}

async function lintOne(source: string, filename: string): Promise<LintResult> {
  const ext = extname(filename).toLowerCase();
  const messages: LintMessage[] = [];
  let working = source;
  let modified = false;

  if (ESLINT_EXTENSIONS.has(ext)) {
    // 1. ESLint autofix — dedup imports, inject missing card-api imports,
    //    resolve template invokables, etc.
    const fixed = await runESLint(working, filename);
    if (typeof fixed.output === 'string' && fixed.output !== working) {
      working = fixed.output;
      modified = true;
    }
    // 2. Prettier as a separate pass over the now-fixed source.
    const formatted = await runPrettier(working, filename);
    if (formatted !== working) {
      working = formatted;
      modified = true;
    }
    // 3. Settle any fixes Prettier's reflow re-triggered, and collect the
    //    residual messages against the final formatted output.
    const settled = await runESLint(working, filename);
    if (typeof settled.output === 'string' && settled.output !== working) {
      working = settled.output;
      modified = true;
    }
    for (const m of settled.messages) {
      messages.push({
        ruleId: m.ruleId ?? null,
        severity: (m.severity === 2 ? 2 : 1) as 1 | 2,
        message: m.message,
        line: m.line ?? 1,
        column: m.column ?? 1,
        endLine: m.endLine,
        endColumn: m.endColumn,
        source: 'eslint',
      });
    }
  }

  if (TEMPLATE_LINT_EXTENSIONS.has(ext)) {
    const { output, messages: tlMessages } = await runTemplateLint(
      working,
      filename,
    );
    if (typeof output === 'string' && output !== working) {
      working = output;
      modified = true;
    }
    for (const m of tlMessages) {
      messages.push({
        ruleId: m.rule ?? null,
        severity: (m.severity === 2 ? 2 : 1) as 1 | 2,
        message: m.message,
        line: m.line ?? 1,
        column: m.column ?? 1,
        endLine: m.endLine,
        endColumn: m.endColumn,
        source: 'template-lint',
      });
    }
  }

  const passed = !messages.some((m) => m.severity === 2);
  return {
    passed,
    output: working,
    fixed: modified,
    messages,
  };
}

async function runESLint(
  source: string,
  filename: string,
): Promise<{ output?: string; messages: Linter.LintMessage[] }> {
  const eslint = await getESLint();
  let filePath = resolve(LINT_ANCHOR, filename);
  // Host config has no .gjs parser override; lint as .gts (same parser).
  if (filePath.endsWith('.gjs')) {
    filePath = `${filePath.slice(0, -4)}.gts`;
  }
  try {
    const results = await eslint.lintText(source, { filePath });
    const r = results[0] ?? {};
    return { output: r.output, messages: r.messages ?? [] };
  } catch (e) {
    // A parser/plugin can throw on malformed input. Surface a clean diagnostic
    // rather than letting a (potentially circular) error object propagate into
    // the job result, where JSON serialization would crash the worker.
    return {
      output: undefined,
      messages: [
        {
          ruleId: null,
          severity: 2,
          message: `ESLint failed to process source: ${
            e && typeof e === 'object' && 'message' in e
              ? (e as Error).message
              : String(e)
          }`,
          line: 1,
          column: 1,
        } as Linter.LintMessage,
      ],
    };
  }
}

async function runPrettier(source: string, filename: string): Promise<string> {
  try {
    const prettier = await import(/* webpackIgnore: true */ 'prettier');
    const config = await resolvePrettierConfig(filename);
    return await prettier.format(source, config);
  } catch {
    // Prettier can't parse malformed source — keep the ESLint-fixed output.
    return source;
  }
}

async function runTemplateLint(
  source: string,
  filename: string,
): Promise<{ output?: string; messages: any[] }> {
  const linter = await getTemplateLinter();
  const result = await linter.verifyAndFix({
    source,
    moduleId: filename,
    filePath: resolve(LINT_ANCHOR, filename),
  });
  return { output: result.output, messages: result.messages ?? [] };
}
