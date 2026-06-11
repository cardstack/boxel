/**
 * Eval execution — shared engine used by both the validation pipeline's
 * `EvalValidationStep` (which writes an `EvalResult` card artifact) and the
 * in-memory `run_evaluate` agent tool (which returns results without side
 * effects).
 *
 * Each file discovered in the realm is evaluated by calling the
 * `evaluate-module` host command via `_run-command`. The host command hits
 * `/_prerender-module` which loads and instantiates the module in a
 * headless Chrome sandbox, so broken imports, circular references, and
 * top-level runtime errors are all surfaced as a single pass/fail signal
 * per module.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { logger } from './logger.ts';
import { validateRealmRelativePath } from './realm-relative-path.ts';
import { isTransientIndexNotFound, retryWithPoll } from './retry-with-poll.ts';
import {
  cacheKeyForInputs,
  type ValidationRunCache,
} from './validation-run-cache.ts';

let log = logger('eval-execution');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions that can be loaded as ESM modules via the prerenderer. */
export const EVALUABLE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'];

/**
 * Test-runner source files — QUnit (`.test.*`) and Playwright (`.spec.*`).
 * These import test-runner APIs (qunit, @playwright/test) and Node-only
 * modules that the prerender sandbox can't resolve, so they must be
 * skipped even though their extension is in EVALUABLE_EXTENSIONS.
 */
const TEST_FILE_PATTERN = /\.(test|spec)\.(gts|gjs|ts|js)$/;

/** TypeScript ambient declaration files — not importable as ESM modules. */
const AMBIENT_DECLARATION_PATTERN = /\.d\.ts$/;

/**
 * Precedence used when multiple discovered files collapse to the same
 * extension-less module URL (e.g. `foo.gts` and `foo.js`). Boxel source
 * realms are `.gts`-first, so that wins; the rest follow the order Boxel's
 * Loader resolves extensions.
 */
const EXTENSION_PRECEDENCE = ['.gts', '.gjs', '.ts', '.js'];

const EVALUATE_MODULE_COMMAND =
  '@cardstack/boxel-host/commands/evaluate-module/default';

// ---------------------------------------------------------------------------
// Shared engine types
// ---------------------------------------------------------------------------

export interface EvalModuleResult {
  passed: boolean;
  error?: string;
  stackTrace?: string;
}

export interface EvalModuleRecord {
  path: string;
  error: string;
  stackTrace?: string;
}

export interface EvaluateRealmModulesOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  realmServerUrl: string;
  /** Injected for testing — defaults to client.runCommand → evaluate-module. */
  evaluateModuleFn?: (
    moduleUrl: string,
    realmUrl: string,
  ) => Promise<EvalModuleResult>;
  /**
   * When set, the engine run is memoized per workspace fingerprint + file
   * set, so the agent's mid-turn `run_evaluate` and the pipeline's eval
   * step don't both prerender the same unchanged modules.
   */
  cache?: ValidationRunCache;
}

export interface EvaluateRealmModulesOutput {
  /** Per-module records for every evaluated file (pass or fail). */
  moduleResults: EvalModuleRecord[];
  /** Records for modules that failed to evaluate. */
  failedModules: EvalModuleRecord[];
  durationMs: number;
}

export interface DiscoverEvaluableFilesOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
}

// ---------------------------------------------------------------------------
// In-memory tool types
// ---------------------------------------------------------------------------

export interface RunEvaluateInMemoryOptions {
  targetRealm: string;
  realmServerUrl: string;
  client: BoxelCLIClient;
  /**
   * When set, evaluate only this realm-relative file instead of discovering
   * every non-test ESM module. Useful for mid-turn self-validation right
   * after writing a single file. The extension must be one of `.gts`,
   * `.gjs`, `.ts`, or `.js` — other paths return `status: 'error'` without
   * calling the realm. A `.test.*` path is rejected for the same reason the
   * whole-realm pass excludes them: the test runner (not the evaluator)
   * validates test files.
   */
  path?: string;
  /** See {@link EvaluateRealmModulesOptions.cache}. */
  cache?: ValidationRunCache;
}

export interface RunEvaluateFailure {
  path: string;
  error: string;
  stackTrace?: string;
}

export interface RunEvaluateResult {
  status: 'passed' | 'failed' | 'error';
  modulesChecked: number;
  modulesWithErrors: number;
  durationMs: number;
  /** Realm-relative evaluable file paths discovered before the run. */
  evaluableFiles: string[];
  /** Only the modules that failed to evaluate. */
  failures: RunEvaluateFailure[];
  /** Set only when `status === 'error'`. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Public engine
// ---------------------------------------------------------------------------

/**
 * Discover evaluable files in the target realm — `.gts`, `.gjs`, `.ts`,
 * `.js`, minus `.test.*` / `.spec.*` test-runner sources and `.d.ts`
 * ambient declarations. When multiple files collapse to the same
 * extension-less module URL (e.g. `foo.gts` and `foo.js`), keeps only the
 * one with the highest-precedence extension. Returns an
 * alphabetically-sorted list.
 */
export async function discoverEvaluableFiles(
  options: DiscoverEvaluableFilesOptions,
): Promise<string[]> {
  let fetchFilenames =
    options.fetchFilenames ??
    ((realmUrl: string) => options.client.listFiles(realmUrl));

  let result = await fetchFilenames(options.targetRealm);
  if (result.error) {
    log.warn(`Failed to fetch realm filenames: ${result.error}`);
    throw new Error(result.error);
  }

  let candidates = (result.filenames ?? []).filter(
    (f) =>
      EVALUABLE_EXTENSIONS.some((ext) => f.endsWith(ext)) &&
      !TEST_FILE_PATTERN.test(f) &&
      !AMBIENT_DECLARATION_PATTERN.test(f),
  );

  // Dedupe by extension-less module URL, keeping the highest-precedence
  // extension per basename. The prerender Loader resolves extension-less
  // URLs, so two source files collapsing to the same URL would otherwise
  // double-count or misattribute failures.
  let byBasename = new Map<string, string>();
  for (let file of candidates) {
    let basename = stripEsmExtension(file);
    let existing = byBasename.get(basename);
    if (!existing || hasHigherPrecedence(file, existing)) {
      byBasename.set(basename, file);
    }
  }

  return Array.from(byBasename.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Evaluate a set of discovered files via the `evaluate-module` host
 * command. Failures thrown by a single module evaluation are captured
 * in-place; they do not abort the run.
 */
export async function evaluateRealmModules(
  options: EvaluateRealmModulesOptions,
  files: string[],
): Promise<EvaluateRealmModulesOutput> {
  if (options.cache) {
    let key = `evaluate:${cacheKeyForInputs(files)}`;
    return options.cache.getOrRun(key, () =>
      evaluateRealmModulesUncached(options, files),
    );
  }
  return evaluateRealmModulesUncached(options, files);
}

async function evaluateRealmModulesUncached(
  options: EvaluateRealmModulesOptions,
  files: string[],
): Promise<EvaluateRealmModulesOutput> {
  let evaluateModuleFn =
    options.evaluateModuleFn ??
    ((moduleUrl: string, realmUrl: string) =>
      defaultEvaluateModule(
        options.client,
        options.realmServerUrl,
        moduleUrl,
        realmUrl,
      ));

  let startedAt = Date.now();
  let moduleResults: EvalModuleRecord[] = [];
  let failedModules: EvalModuleRecord[] = [];

  for (let file of files) {
    let moduleUrl = toModuleUrl(file, options.targetRealm);

    try {
      let result = await evaluateModuleFn(moduleUrl, options.targetRealm);
      moduleResults.push({
        path: file,
        error: result.error ?? '',
        stackTrace: result.stackTrace,
      });

      if (!result.passed) {
        failedModules.push({
          path: file,
          error: result.error ?? 'Module evaluation failed',
          stackTrace: result.stackTrace,
        });
      }
    } catch (err) {
      let message = `Eval failed: ${err instanceof Error ? err.message : String(err)}`;
      log.warn(`Error evaluating ${file}: ${message}`);
      moduleResults.push({ path: file, error: message });
      failedModules.push({ path: file, error: message });
    }
  }

  return {
    moduleResults,
    failedModules,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// In-memory agent tool
// ---------------------------------------------------------------------------

/**
 * Evaluate every non-test ESM module in the target realm (or just one
 * named file) via `/_prerender-module` and return a flat, JSON-friendly
 * result. Unlike `EvalValidationStep`, this does NOT create or update an
 * `EvalResult` card — the result is consumed by the agent directly for
 * mid-turn self-validation.
 */
export async function runEvaluateInMemory(
  options: RunEvaluateInMemoryOptions,
): Promise<RunEvaluateResult> {
  let evaluableFiles: string[];
  if (options.path) {
    let path = options.path;
    let pathError = validateRealmRelativePath(path);
    if (pathError) {
      return emptyErrorResult(pathError);
    }
    if (!EVALUABLE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return emptyErrorResult(
        `Path "${path}" is not evaluable — must end with one of ${EVALUABLE_EXTENSIONS.join(', ')}`,
      );
    }
    if (AMBIENT_DECLARATION_PATTERN.test(path)) {
      return emptyErrorResult(
        `Path "${path}" is a TypeScript ambient declaration — run_evaluate only evaluates importable ESM modules.`,
      );
    }
    if (TEST_FILE_PATTERN.test(path)) {
      return emptyErrorResult(
        `Path "${path}" is a test file — run_evaluate only evaluates non-test modules. The test runner validates test files.`,
      );
    }
    evaluableFiles = [path];
  } else {
    try {
      evaluableFiles = await discoverEvaluableFiles({
        targetRealm: options.targetRealm,
        client: options.client,
      });
    } catch (err) {
      return emptyErrorResult(
        `Failed to discover evaluable files: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (evaluableFiles.length === 0) {
    return {
      status: 'passed',
      modulesChecked: 0,
      modulesWithErrors: 0,
      durationMs: 0,
      evaluableFiles: [],
      failures: [],
    };
  }

  try {
    let { moduleResults, failedModules, durationMs } =
      await evaluateRealmModules(
        {
          targetRealm: options.targetRealm,
          realmServerUrl: options.realmServerUrl,
          client: options.client,
          cache: options.cache,
        },
        evaluableFiles,
      );

    return {
      status: failedModules.length === 0 ? 'passed' : 'failed',
      modulesChecked: moduleResults.length,
      modulesWithErrors: failedModules.length,
      durationMs,
      evaluableFiles,
      failures: failedModules.map((m) => ({
        path: m.path,
        error: m.error,
        stackTrace: m.stackTrace,
      })),
    };
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`runEvaluateInMemory error: ${errorMessage}`);
    return {
      status: 'error',
      modulesChecked: 0,
      modulesWithErrors: 0,
      durationMs: 0,
      evaluableFiles,
      failures: [],
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toModuleUrl(file: string, realmUrl: string): string {
  // Strip any ESM extension — the prerenderer's Loader resolves extensionless
  // URLs to whichever source file exists (.gts, .gjs, .ts, or .js). Discovery
  // dedupes collisions by EXTENSION_PRECEDENCE before we get here, so one
  // basename → one evaluation.
  let withoutExt = stripEsmExtension(file);
  return new URL(withoutExt, ensureTrailingSlash(realmUrl)).href;
}

function stripEsmExtension(file: string): string {
  return file.replace(/\.(gts|gjs|ts|js)$/, '');
}

function hasHigherPrecedence(candidate: string, existing: string): boolean {
  return getExtensionRank(candidate) < getExtensionRank(existing);
}

function getExtensionRank(file: string): number {
  for (let i = 0; i < EXTENSION_PRECEDENCE.length; i++) {
    if (file.endsWith(EXTENSION_PRECEDENCE[i])) {
      return i;
    }
  }
  return EXTENSION_PRECEDENCE.length;
}

async function defaultEvaluateModule(
  client: BoxelCLIClient,
  realmServerUrl: string,
  moduleUrl: string,
  realmUrl: string,
): Promise<EvalModuleResult> {
  // Source POSTs return before realm indexing settles, so a load attempt
  // immediately after a write can transiently fail with "module URL not
  // found" until the in-memory module map is populated. Bound-poll past
  // that race; isTransientIndexNotFound stops matching the moment
  // indexing resolves either way (success or error_doc), so retries
  // never persist past a real indexer failure.
  return retryWithPoll(
    () => attemptEvaluateModule(client, realmServerUrl, moduleUrl, realmUrl),
    (r) => !r.passed && isTransientIndexNotFound(r.error),
  );
}

async function attemptEvaluateModule(
  client: BoxelCLIClient,
  realmServerUrl: string,
  moduleUrl: string,
  realmUrl: string,
): Promise<EvalModuleResult> {
  let response = await client.runCommand(
    realmServerUrl,
    realmUrl,
    EVALUATE_MODULE_COMMAND,
    { moduleIdentifier: moduleUrl, realmIdentifier: realmUrl },
  );

  log.debug(
    `run-command response for ${moduleUrl}: status=${response.status}, error=${response.error}, result=${response.result}`,
  );

  if (response.status !== 'ready') {
    return {
      passed: false,
      error: response.error ?? `run-command returned ${response.status} status`,
    };
  }

  if (response.result) {
    try {
      let cardDoc = JSON.parse(response.result);
      let attrs = cardDoc?.data?.attributes ?? cardDoc;
      if (attrs.passed === false) {
        return {
          passed: false,
          error: attrs.error ?? 'Module evaluation failed',
          stackTrace: attrs.stackTrace,
        };
      }
      return { passed: true };
    } catch {
      log.warn(
        `Failed to parse run-command result for ${moduleUrl}: ${response.result?.slice(0, 200)}`,
      );
      return {
        passed: false,
        error:
          'run-command returned an unparsable result — treating as failure',
      };
    }
  }

  return {
    passed: false,
    error: 'run-command did not return a result — treating as failure',
  };
}

function emptyErrorResult(errorMessage: string): RunEvaluateResult {
  return {
    status: 'error',
    modulesChecked: 0,
    modulesWithErrors: 0,
    durationMs: 0,
    evaluableFiles: [],
    failures: [],
    errorMessage,
  };
}
