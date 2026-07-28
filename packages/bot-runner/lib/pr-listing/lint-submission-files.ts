import {
  logger,
  userInitiatedPriority,
  type LintArgs,
  type LintMessage,
  type LintResult,
  type QueuePublisher,
} from '@cardstack/runtime-common';
import { extname } from 'node:path';

export interface SubmissionFile {
  filename: string;
  contents: string;
}

export interface LintOutcome {
  passed: boolean;
  fixedFiles: SubmissionFile[];
  lintErrors: string[];
  fixedFileCount: number;
}

const log = logger('bot-runner');

// Union of the lint-source task's ESLINT_EXTENSIONS and
// TEMPLATE_LINT_EXTENSIONS (runtime-common/tasks/lint.ts); other files pass
// through the lint step untouched.
const LINTABLE_EXTENSIONS = new Set(['.js', '.ts', '.gjs', '.gts', '.hbs']);

const LINT_JOB_TIMEOUT_SEC = 30;

export function makeLintSubmissionFiles(queuePublisher: QueuePublisher) {
  return async function lintSubmissionFiles(
    files: SubmissionFile[],
    opts: { roomId: string; listingId: string },
  ): Promise<LintOutcome> {
    let lintableCount = files.filter(isLintable).length;
    log.info('submission lint: publishing lint-source jobs', {
      roomId: opts.roomId,
      listingId: opts.listingId,
      fileCount: files.length,
      lintableCount,
    });

    let results = await Promise.all(
      files.map((file, i) =>
        isLintable(file) ? lintFileViaJob(queuePublisher, file, i) : null,
      ),
    );

    let fixedFiles: SubmissionFile[] = [];
    let lintErrors: string[] = [];
    let fixedFileCount = 0;
    for (let [i, file] of files.entries()) {
      let result = results[i];
      if (!result) {
        fixedFiles.push(file);
        continue;
      }
      let contents =
        result.fixed &&
        typeof result.output === 'string' &&
        result.output !== file.contents
          ? result.output
          : file.contents;
      if (contents !== file.contents) {
        fixedFileCount++;
      }
      fixedFiles.push({ filename: file.filename, contents });
      for (let message of result.messages) {
        if (message.severity === 2) {
          lintErrors.push(formatLintError(file.filename, message));
        }
      }
    }

    let outcome: LintOutcome = {
      passed: lintErrors.length === 0,
      fixedFiles,
      lintErrors,
      fixedFileCount,
    };
    log.info('submission lint: completed', {
      roomId: opts.roomId,
      listingId: opts.listingId,
      passed: outcome.passed,
      errorCount: lintErrors.length,
      fixedFileCount,
    });
    return outcome;
  };
}

function isLintable(file: SubmissionFile): boolean {
  return LINTABLE_EXTENSIONS.has(extname(file.filename).toLowerCase());
}

async function lintFileViaJob(
  queuePublisher: QueuePublisher,
  file: SubmissionFile,
  index: number,
): Promise<LintResult> {
  let job = await queuePublisher.publish<LintResult>({
    jobType: 'lint-source',
    // 10-way shard (mirroring the realm _lint endpoint's spread, keyed by
    // file index here) so concurrent submissions can lint in parallel
    // without flooding the worker pool.
    concurrencyGroup: `lint:submission:${index % 10}`,
    timeout: LINT_JOB_TIMEOUT_SEC,
    priority: userInitiatedPriority,
    args: {
      source: file.contents,
      filename: file.filename,
    } satisfies LintArgs,
  });
  try {
    return await job.done;
  } catch (err) {
    throw new Error(
      `lint-source job failed for ${file.filename}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

function formatLintError(filename: string, message: LintMessage): string {
  let rule = message.ruleId ?? message.source ?? 'lint';
  return `${filename}:${message.line}:${message.column} [${rule}] ${message.message}`;
}
