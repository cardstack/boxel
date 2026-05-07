/**
 * Lint execution — shared engine used by both the validation pipeline's
 * `LintValidationStep` (which writes a `LintResult` card artifact) and the
 * in-memory `run_lint` agent tool (which returns results without side
 * effects).
 *
 * The realm's `_lint` endpoint (ESLint + Prettier + `@cardstack/boxel`
 * rules) is the same endpoint the Monaco editor uses in code mode.
 */

import type { BoxelCLIClient, LintResult } from '@cardstack/boxel-cli/api';

import type {
  LintFileResultData,
  LintViolationData,
} from './lint-result-cards';
import { logger } from './logger';
import { validateRealmRelativePath } from './realm-relative-path';
import { readCard } from './workspace-fs';

let log = logger('lint-execution');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LINTABLE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'];

// ---------------------------------------------------------------------------
// Shared engine types
// ---------------------------------------------------------------------------

/** Flattened error violation — used by both validator details and in-memory. */
export interface LintErrorViolation {
  rule: string;
  file: string;
  line: number;
  message: string;
}

export interface LintRealmFilesOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory to read source files from. The realm is
   * used for linting (the `_lint` endpoint), not for fetching content.
   */
  workspaceDir: string;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to client.lint. */
  lintFileFn?: (
    realmUrl: string,
    source: string,
    filename: string,
  ) => Promise<LintResult>;
  /** Injected for testing — defaults to reading from the workspace. */
  readFileFn?: (
    realmUrl: string,
    path: string,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
}

export interface LintRealmFilesOutput {
  fileResults: LintFileResultData[];
  /** Error-severity violations, flattened across files. */
  errorViolations: LintErrorViolation[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// In-memory tool types
// ---------------------------------------------------------------------------

export interface RunLintInMemoryOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory to read source files from. The realm is used
   * only for the `_lint` POST; content comes from disk.
   */
  workspaceDir: string;
  /**
   * When set, lint only this realm-relative file instead of discovering
   * all lintable files. Useful for mid-turn self-validation right after
   * writing a single file. The extension must be one of `.gts`, `.gjs`,
   * `.ts`, or `.js` — other paths return `status: 'error'` without
   * calling the realm.
   */
  path?: string;
}

export interface RunLintViolation {
  rule: string;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface RunLintResult {
  status: 'passed' | 'failed' | 'error';
  filesChecked: number;
  filesWithErrors: number;
  errorCount: number;
  warningCount: number;
  durationMs: number;
  /** Realm-relative lintable file paths discovered before the run. */
  lintableFiles: string[];
  /** All violations (errors and warnings) across all files. */
  violations: RunLintViolation[];
  /** Set only when `status === 'error'`. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Public engine
// ---------------------------------------------------------------------------

/**
 * Discover lintable files in the target realm — `.gts`, `.gjs`, `.ts`, `.js`.
 * Returns an alphabetically-sorted list.
 */
export async function discoverLintableFiles(
  options: Pick<
    LintRealmFilesOptions,
    'targetRealm' | 'client' | 'fetchFilenames'
  >,
): Promise<string[]> {
  let fetchFilenames =
    options.fetchFilenames ??
    ((realmUrl: string) => options.client.listFiles(realmUrl));

  let result = await fetchFilenames(options.targetRealm);
  if (result.error) {
    log.warn(`Failed to fetch realm filenames: ${result.error}`);
    throw new Error(result.error);
  }

  return result.filenames
    .filter((f) => LINTABLE_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Lint a set of discovered files via the realm's `_lint` endpoint. Returns
 * per-file violations and a flat list of error-severity violations. Failures
 * reading or linting a single file are captured in-place as synthetic
 * `lint-error` entries; they do not abort the run.
 */
export async function lintRealmFiles(
  options: LintRealmFilesOptions,
  files: string[],
): Promise<LintRealmFilesOutput> {
  let lintFileFn =
    options.lintFileFn ??
    ((realmUrl: string, source: string, filename: string) =>
      options.client.lint(realmUrl, source, filename));
  let readFileFn =
    options.readFileFn ??
    (async (_realmUrl: string, path: string) => {
      let result = await readCard(options.workspaceDir, path);
      return {
        ok: result.ok,
        content: result.content,
        error: result.error,
      };
    });

  let startedAt = Date.now();
  let fileResults: LintFileResultData[] = [];
  let errorViolations: LintErrorViolation[] = [];

  for (let file of files) {
    try {
      let readResult = await readFileFn(options.targetRealm, file);
      if (!readResult.ok) {
        recordReadError(
          file,
          readResult.error ?? 'read failed',
          fileResults,
          errorViolations,
        );
        continue;
      }
      if (readResult.content == null) {
        recordReadError(file, 'no content', fileResults, errorViolations);
        continue;
      }

      let lintResponse = await lintFileFn(
        options.targetRealm,
        readResult.content,
        file,
      );

      let violations: LintViolationData[] = (lintResponse.messages ?? []).map(
        (msg) => ({
          rule: msg.ruleId ?? 'unknown',
          file,
          line: msg.line,
          column: msg.column,
          message: msg.message,
          severity:
            msg.severity === 2 ? ('error' as const) : ('warning' as const),
        }),
      );

      fileResults.push({ file, violations });

      for (let v of violations) {
        if (v.severity === 'error') {
          errorViolations.push({
            rule: v.rule ?? 'unknown',
            file: v.file,
            line: v.line,
            message: v.message,
          });
        }
      }
    } catch (err) {
      let message = `Lint failed: ${err instanceof Error ? err.message : String(err)}`;
      log.warn(`Error linting ${file}: ${message}`);
      recordSyntheticError(file, message, fileResults, errorViolations);
    }
  }

  return {
    fileResults,
    errorViolations,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// In-memory agent tool
// ---------------------------------------------------------------------------

/**
 * Run ESLint + Prettier via the realm's `_lint` endpoint on every lintable
 * file and return a flat, JSON-friendly result. Unlike `LintValidationStep`,
 * this does NOT create or update a `LintResult` card — the result is
 * consumed by the agent directly for mid-turn self-validation.
 */
export async function runLintInMemory(
  options: RunLintInMemoryOptions,
): Promise<RunLintResult> {
  let lintableFiles: string[];
  if (options.path) {
    let path = options.path;
    let pathError = validateRealmRelativePath(path);
    if (pathError) {
      return emptyErrorResult(pathError);
    }
    if (!LINTABLE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return emptyErrorResult(
        `Path "${path}" is not lintable — must end with one of ${LINTABLE_EXTENSIONS.join(', ')}`,
      );
    }
    lintableFiles = [path];
  } else {
    try {
      lintableFiles = await discoverLintableFiles({
        targetRealm: options.targetRealm,
        client: options.client,
      });
    } catch (err) {
      return emptyErrorResult(
        `Failed to discover lintable files: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (lintableFiles.length === 0) {
    return {
      status: 'passed',
      filesChecked: 0,
      filesWithErrors: 0,
      errorCount: 0,
      warningCount: 0,
      durationMs: 0,
      lintableFiles: [],
      violations: [],
    };
  }

  try {
    let { fileResults, durationMs } = await lintRealmFiles(
      {
        targetRealm: options.targetRealm,
        client: options.client,
        workspaceDir: options.workspaceDir,
      },
      lintableFiles,
    );

    let violations: RunLintViolation[] = [];
    let errorCount = 0;
    let warningCount = 0;
    let filesWithErrors = 0;
    for (let fr of fileResults) {
      let fileHasError = false;
      for (let v of fr.violations) {
        violations.push({
          rule: v.rule ?? 'unknown',
          file: v.file,
          line: v.line,
          column: v.column,
          message: v.message,
          severity: v.severity,
        });
        if (v.severity === 'error') {
          errorCount += 1;
          fileHasError = true;
        } else {
          warningCount += 1;
        }
      }
      if (fileHasError) filesWithErrors += 1;
    }

    return {
      status: errorCount === 0 ? 'passed' : 'failed',
      filesChecked: fileResults.length,
      filesWithErrors,
      errorCount,
      warningCount,
      durationMs,
      lintableFiles,
      violations,
    };
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`runLintInMemory error: ${errorMessage}`);
    return {
      status: 'error',
      filesChecked: 0,
      filesWithErrors: 0,
      errorCount: 0,
      warningCount: 0,
      durationMs: 0,
      lintableFiles,
      violations: [],
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordReadError(
  file: string,
  detail: string,
  fileResults: LintFileResultData[],
  errorViolations: LintErrorViolation[],
): void {
  let message = `Could not read ${file}: ${detail}`;
  log.warn(message);
  recordSyntheticError(file, message, fileResults, errorViolations);
}

function recordSyntheticError(
  file: string,
  message: string,
  fileResults: LintFileResultData[],
  errorViolations: LintErrorViolation[],
): void {
  fileResults.push({
    file,
    violations: [
      {
        rule: 'lint-error',
        file,
        line: 0,
        column: 0,
        message,
        severity: 'error',
      },
    ],
  });
  errorViolations.push({ rule: 'lint-error', file, line: 0, message });
}

function emptyErrorResult(errorMessage: string): RunLintResult {
  return {
    status: 'error',
    filesChecked: 0,
    filesWithErrors: 0,
    errorCount: 0,
    warningCount: 0,
    durationMs: 0,
    lintableFiles: [],
    violations: [],
    errorMessage,
  };
}
