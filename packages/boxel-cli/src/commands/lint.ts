import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { FG_RED, FG_YELLOW, DIM, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';
import { validateRealmRelativePath } from '../lib/realm-relative-path.ts';
import { lint as lintSingleFile, type LintMessage } from './file/lint.ts';
import { listFiles } from './file/list.ts';
import { resolveRealmIdentifier } from '../lib/resolve-realm-identifier.ts';

const LINTABLE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'] as const;

export interface LintRealmViolation {
  rule: string | null;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface LintRealmResult {
  status: 'passed' | 'failed' | 'error';
  filesChecked: number;
  filesWithErrors: number;
  errorCount: number;
  warningCount: number;
  durationMs: number;
  lintableFiles: string[];
  violations: LintRealmViolation[];
  errorMessage?: string;
}

export interface LintRealmOptions {
  /** Optional realm-relative path. When set, lints only that file. */
  path?: string;
  profileManager?: ProfileManager;
}

/**
 * Lint every lintable file (`.gts`, `.gjs`, `.ts`, `.js`) in a realm,
 * or a single file when `options.path` is set. Source is fetched from
 * the realm; the realm's `_lint` endpoint runs ESLint + Prettier with
 * the `@cardstack/boxel` rules.
 */
export async function lintRealm(
  realmUrl: string,
  options?: LintRealmOptions,
): Promise<LintRealmResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return emptyErrorResult(NO_ACTIVE_PROFILE_ERROR);
  }

  let resolvedRealm = resolveRealmIdentifier(realmUrl, { profileManager: pm });
  if (!resolvedRealm.ok) {
    return emptyErrorResult(resolvedRealm.error);
  }
  realmUrl = resolvedRealm.url;

  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
  let startedAt = Date.now();

  let lintableFiles: string[];
  if (options?.path) {
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
    let listResult = await listFiles(normalizedRealmUrl, {
      profileManager: pm,
    });
    if (listResult.error) {
      return emptyErrorResult(
        `Failed to list realm files: ${listResult.error}`,
      );
    }
    lintableFiles = listResult.filenames.filter((f) =>
      LINTABLE_EXTENSIONS.some((ext) => f.endsWith(ext)),
    );
  }

  if (lintableFiles.length === 0) {
    return {
      status: 'passed',
      filesChecked: 0,
      filesWithErrors: 0,
      errorCount: 0,
      warningCount: 0,
      durationMs: Date.now() - startedAt,
      lintableFiles: [],
      violations: [],
    };
  }

  let violations: LintRealmViolation[] = [];
  let filesWithErrors = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (let file of lintableFiles) {
    let source: string;
    try {
      let readUrl = new URL(file, normalizedRealmUrl).href;
      let response = await pm.authedRealmFetch(readUrl, {
        method: 'GET',
        headers: { Accept: SupportedMimeType.CardSource },
      });
      if (!response.ok) {
        let body = await response.text().catch(() => '(no body)');
        recordReadError(
          file,
          `HTTP ${response.status}: ${body.slice(0, 300)}`,
          violations,
        );
        filesWithErrors += 1;
        errorCount += 1;
        continue;
      }
      source = await response.text();
    } catch (err) {
      recordReadError(
        file,
        err instanceof Error ? err.message : String(err),
        violations,
      );
      filesWithErrors += 1;
      errorCount += 1;
      continue;
    }

    let result = await lintSingleFile(normalizedRealmUrl, source, file, {
      profileManager: pm,
    });

    if (!result.ok) {
      recordReadError(file, result.error ?? 'lint failed', violations);
      filesWithErrors += 1;
      errorCount += 1;
      continue;
    }

    let fileHasError = false;
    for (let msg of result.messages ?? []) {
      let severity: 'error' | 'warning' =
        msg.severity === 2 ? 'error' : 'warning';
      violations.push({
        rule: msg.ruleId,
        file,
        line: msg.line,
        column: msg.column,
        message: msg.message,
        severity,
      });
      if (severity === 'error') {
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
    filesChecked: lintableFiles.length,
    filesWithErrors,
    errorCount,
    warningCount,
    durationMs: Date.now() - startedAt,
    lintableFiles,
    violations,
  };
}

function recordReadError(
  file: string,
  detail: string,
  violations: LintRealmViolation[],
): void {
  violations.push({
    rule: 'lint-error',
    file,
    line: 0,
    column: 0,
    message: detail,
    severity: 'error',
  });
}

function emptyErrorResult(message: string): LintRealmResult {
  return {
    status: 'error',
    filesChecked: 0,
    filesWithErrors: 0,
    errorCount: 0,
    warningCount: 0,
    durationMs: 0,
    lintableFiles: [],
    violations: [],
    errorMessage: message,
  };
}

interface LintCliOptions {
  realm: string;
  json?: boolean;
}

export function registerLintCommand(program: Command): void {
  program
    .command('lint')
    .description(
      'Lint every lintable (.gts/.gjs/.ts/.js) file in a realm via the realm lint endpoint. Pass a realm-relative path to lint a single file.',
    )
    .argument(
      '[path]',
      'Optional realm-relative file path. When omitted, lints every lintable file in the realm.',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to lint against')
    .option('--json', 'Output structured JSON result')
    .action(async (path: string | undefined, opts: LintCliOptions) => {
      let result: LintRealmResult;
      try {
        result = await lintRealm(opts.realm, path ? { path } : {});
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (result.status !== 'passed') {
          process.exit(1);
        }
        return;
      }

      if (result.errorMessage) {
        console.error(`${FG_RED}Error:${RESET} ${result.errorMessage}`);
        process.exit(1);
      }

      if (result.violations.length === 0) {
        console.log(
          `${DIM}No lint issues found (${result.filesChecked} file(s) checked).${RESET}`,
        );
        return;
      }

      let currentFile: string | undefined;
      for (let v of result.violations) {
        if (v.file !== currentFile) {
          currentFile = v.file;
          console.log(`\n${DIM}${v.file}${RESET}`);
        }
        let color = v.severity === 'error' ? FG_RED : FG_YELLOW;
        let rule = v.rule ? ` (${v.rule})` : '';
        console.log(
          `  ${color}${v.severity}${RESET} ${v.line}:${v.column} ${v.message}${DIM}${rule}${RESET}`,
        );
      }

      console.log(
        `\n${DIM}${result.errorCount} error(s), ${result.warningCount} warning(s) across ${result.filesChecked} file(s)${RESET}`,
      );

      if (result.errorCount > 0) {
        process.exit(1);
      }
    });
}

// Re-export for callers that want the type alongside the function.
export type { LintMessage };
