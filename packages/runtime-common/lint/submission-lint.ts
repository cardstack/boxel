import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { logger } from '../log.ts';

if (typeof (globalThis as any).document !== 'undefined') {
  throw new Error(
    'submission-lint can only run in Node (not browser/fastboot)',
  );
}

const log = logger('submission-lint');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CATALOG_DIR = path.join(REPO_ROOT, 'packages', 'catalog');
const HOST_DIR = path.join(REPO_ROOT, 'packages', 'host');
export const SUBMISSIONS_TEMP_ROOT = path.join(
  CATALOG_DIR,
  '__submissions-temp__',
);
const TEMPLATE_LINT_BIN = path.join(
  CATALOG_DIR,
  'node_modules',
  '.bin',
  'ember-template-lint',
);
const EMBER_TSC_BIN = path.join(HOST_DIR, 'node_modules', '.bin', 'ember-tsc');

const TEMPLATE_LINT_EXTENSIONS = ['.hbs', '.gts', '.gjs'];
const TSC_EXTENSIONS = ['.ts', '.gts'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_COUNT = 500;
// Reserved filename for the generated per-run lint tsconfig. Placed inside
// the submission temp dir but guarded against collision with a user-submitted
// file of the same name (see sanitizeRelativePath).
export const LINT_TSCONFIG_FILENAME = '.__submission-lint-tsconfig__.json';

const SPAWN_TIMEOUT_MS = (() => {
  let raw = process.env.BOT_RUNNER_LINT_TIMEOUT_MS;
  let parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
})();

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

interface TemplateLintMessage {
  rule?: string;
  severity?: number;
  line?: number;
  column?: number;
  message?: string;
}

export function sanitizeRelativePath(
  filename: string,
  tempDir: string,
): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('filename is required');
  }
  if (filename.includes('\0')) {
    throw new Error(`filename contains null byte: ${filename}`);
  }
  for (let i = 0; i < filename.length; i++) {
    if (filename.charCodeAt(i) < 0x20) {
      throw new Error(`filename contains control characters: ${filename}`);
    }
  }
  if (path.isAbsolute(filename)) {
    throw new Error(`filename must not be absolute: ${filename}`);
  }
  if (filename.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`filename must not contain ..: ${filename}`);
  }
  if (filename === LINT_TSCONFIG_FILENAME) {
    throw new Error(`filename is reserved: ${filename}`);
  }
  let resolved = path.resolve(tempDir, filename);
  let anchor = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep;
  if (!resolved.startsWith(anchor)) {
    throw new Error(`filename escapes temp dir: ${filename}`);
  }
  return path.relative(tempDir, resolved);
}

export function parseTscOutput(
  output: string,
  submissionPathPrefix: string,
): string[] {
  let errors: string[] = [];
  // Normalize the prefix: forward slashes, strip any trailing slash so we can
  // match whether the caller passed a trailing slash or not.
  let prefix = submissionPathPrefix.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!prefix) return errors;
  for (let rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    let match = line.match(
      /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/,
    );
    if (!match) continue;
    let [, filePath, ln, col, level, code, message] = match;
    if (level !== 'error') continue;
    let normalizedPath = filePath.replace(/\\/g, '/');
    let idx = normalizedPath.indexOf(prefix);
    if (idx < 0) continue;
    // Drop the prefix and any leading slash so display is always clean,
    // regardless of whether the caller passed a trailing slash.
    let displayPath = normalizedPath
      .slice(idx + prefix.length)
      .replace(/^\/+/, '');
    if (!displayPath) continue;
    errors.push(`${displayPath} (${ln}:${col}) ${code}: ${message}`);
  }
  return errors;
}

export function parseTemplateLintOutput(
  stdout: string,
  tempDir: string,
  linterCwd: string,
): string[] {
  let trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: Record<string, TemplateLintMessage[]>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  // ember-template-lint emits keys relative to *its* cwd (the dir where we
  // spawned it), not to the submission's temp dir. Resolve against the linter
  // cwd, then compute the display path relative to tempDir so the user sees
  // just `foo/bar.hbs` instead of `__submissions-temp__/<uuid>/foo/bar.hbs`.
  let errors: string[] = [];
  for (let [filePath, messages] of Object.entries(parsed)) {
    if (!Array.isArray(messages)) continue;
    let absolute = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(linterCwd, filePath);
    let relDisplay = path.relative(tempDir, absolute).replace(/\\/g, '/');
    for (let msg of messages) {
      if (msg.severity !== 2) continue;
      let line = typeof msg.line === 'number' ? msg.line : 0;
      let col = typeof msg.column === 'number' ? msg.column : 0;
      let rule = msg.rule ?? 'unknown';
      let text = msg.message ?? '';
      errors.push(`${relDisplay} (${line}:${col}) ${rule}: ${text}`);
    }
  }
  return errors;
}

export async function runLintOnSubmissionFiles(
  files: SubmissionFile[],
  opts: { roomId: string; listingId: string },
): Promise<LintOutcome> {
  let passthroughFiles = files.map((f) => ({
    filename: f.filename,
    contents: f.contents ?? '',
  }));
  let hasLintable = files.some((f) => {
    let lower = (f.filename ?? '').toLowerCase();
    return (
      TEMPLATE_LINT_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
      TSC_EXTENSIONS.some((ext) => lower.endsWith(ext))
    );
  });
  if (files.length === 0 || !hasLintable) {
    return {
      passed: true,
      fixedFiles: passthroughFiles,
      lintErrors: [],
      fixedFileCount: 0,
    };
  }
  if (files.length > MAX_FILE_COUNT) {
    throw new Error(
      `Too many submission files (${files.length} > ${MAX_FILE_COUNT})`,
    );
  }
  let runId = `${sanitizeIdSegment(opts.roomId)}-${sanitizeIdSegment(
    opts.listingId,
  )}-${crypto.randomUUID()}`;
  let tempDir = path.join(SUBMISSIONS_TEMP_ROOT, runId);
  let tempRelFromCatalog = path.relative(CATALOG_DIR, tempDir);
  let tempRelFromHost = path.relative(HOST_DIR, tempDir).replace(/\\/g, '/');

  let relPaths: string[] = [];
  try {
    await fs.mkdir(tempDir, { recursive: true });
    for (let file of files) {
      let relPath = sanitizeRelativePath(file.filename, tempDir);
      let contents = file.contents ?? '';
      if (Buffer.byteLength(contents, 'utf8') > MAX_FILE_SIZE_BYTES) {
        throw new Error(
          `File exceeds ${MAX_FILE_SIZE_BYTES} bytes: ${file.filename}`,
        );
      }
      let absPath = path.join(tempDir, relPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, contents, 'utf8');
      relPaths.push(relPath);
    }

    let templateLintErrors = await runTemplateLint(
      runId,
      relPaths,
      tempDir,
      tempRelFromCatalog,
    );
    let hasTscFiles = relPaths.some((p) =>
      TSC_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)),
    );
    if (hasTscFiles) {
      await writeSubmissionTsconfig(tempDir, relPaths);
    }
    let tscErrors = hasTscFiles
      ? await runEmberTsc(runId, tempDir, tempRelFromHost)
      : [];

    let fixedFiles: SubmissionFile[] = [];
    let fixedFileCount = 0;
    for (let i = 0; i < files.length; i++) {
      let original = files[i];
      let relPath = relPaths[i];
      let absPath = path.join(tempDir, relPath);
      let fixedContents: string;
      try {
        fixedContents = await fs.readFile(absPath, 'utf8');
      } catch (err: any) {
        log.warn('Could not read back submission file', {
          file: original.filename,
          err: err?.message,
        });
        fixedContents = original.contents ?? '';
      }
      if (fixedContents !== (original.contents ?? '')) {
        fixedFileCount++;
      }
      fixedFiles.push({
        filename: original.filename,
        contents: fixedContents,
      });
    }

    let lintErrors = [...templateLintErrors, ...tscErrors];
    let outcome: LintOutcome = {
      passed: lintErrors.length === 0,
      fixedFiles,
      lintErrors,
      fixedFileCount,
    };
    log.info('Lint complete', {
      runId,
      totalFiles: files.length,
      fixedFileCount,
      templateLintErrorCount: templateLintErrors.length,
      tscErrorCount: tscErrors.length,
      passed: outcome.passed,
    });
    return outcome;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      log.warn('Failed to clean up submission temp dir', {
        tempDir,
        err: err?.message,
      });
    });
  }
}

async function runTemplateLint(
  runId: string,
  relPaths: string[],
  tempDir: string,
  tempRelFromCatalog: string,
): Promise<string[]> {
  let templateFiles = relPaths.filter((p) =>
    TEMPLATE_LINT_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)),
  );
  if (templateFiles.length === 0) return [];

  let args = [
    '--fix',
    '--format',
    'json',
    '--no-error-on-unmatched-pattern',
    ...templateFiles.map((rel) =>
      path.join(tempRelFromCatalog, rel).replace(/\\/g, '/'),
    ),
  ];
  let startedAt = Date.now();
  let result;
  try {
    result = await spawnCapture(TEMPLATE_LINT_BIN, args, CATALOG_DIR);
  } catch (err: any) {
    throw new Error(`[runId=${runId}] template-lint ${err?.message ?? err}`);
  }
  let { stdout, stderr, code } = result;
  log.info('template-lint finished', {
    runId,
    durationMs: Date.now() - startedAt,
    code,
    fileCount: templateFiles.length,
  });
  // ember-template-lint: 0 = clean, 1 = lint errors present (with --format
  // json, stdout still contains the JSON report). Anything else (crash,
  // bad args, null from signal) is a hard failure — don't let silent
  // failure let a bad submission sail through.
  if (code !== 0 && code !== 1) {
    throw new Error(
      `[runId=${runId}] ember-template-lint exited with unexpected code ${code}: ${stderr.slice(0, 500)}`,
    );
  }
  return parseTemplateLintOutput(stdout, tempDir, CATALOG_DIR);
}

async function runEmberTsc(
  runId: string,
  tempDir: string,
  tempRelFromHost: string,
): Promise<string[]> {
  let args = ['--noEmit', '-p', path.join(tempDir, LINT_TSCONFIG_FILENAME)];
  let startedAt = Date.now();
  let result;
  try {
    result = await spawnCapture(EMBER_TSC_BIN, args, HOST_DIR);
  } catch (err: any) {
    throw new Error(`[runId=${runId}] ember-tsc ${err?.message ?? err}`);
  }
  let { stdout, stderr, code } = result;
  log.info('ember-tsc finished', {
    runId,
    durationMs: Date.now() - startedAt,
    code,
  });
  if (code === 0) return [];
  // tsc exits 1 when it reports type errors, 2 for "fatal" diagnostics.
  // Anything outside {0,1,2} (e.g. null from a signal, or a much larger
  // code from a crash) means the type-check didn't run to completion —
  // treat as a hard failure so we don't ship a bad submission.
  if (code !== 1 && code !== 2) {
    throw new Error(
      `[runId=${runId}] ember-tsc exited with unexpected code ${code}: ${stderr.slice(0, 500)}`,
    );
  }
  let combined = `${stdout}\n${stderr}`;
  return parseTscOutput(combined, tempRelFromHost);
}

// The per-run tsconfig lists the submission files explicitly in `include` so
// tsc loads them without relying on the extended host tsconfig's include glob
// to cover wherever the temp dir happens to live. Inherits compilerOptions
// (paths aliases, lib, etc.) from host via `extends`.
async function writeSubmissionTsconfig(
  tempDir: string,
  relPaths: string[],
): Promise<void> {
  let toPosix = (p: string): string => p.split(path.sep).join('/');
  let prefixRelative = (p: string): string =>
    p.startsWith('.') ? p : './' + p;
  let extendsPath = prefixRelative(
    toPosix(path.relative(tempDir, path.join(HOST_DIR, 'tsconfig.json'))),
  );
  let tscIncludes = relPaths
    .filter((p) => TSC_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)))
    .map(toPosix);
  let tsconfig = {
    extends: extendsPath,
    include: tscIncludes,
  };
  await fs.writeFile(
    path.join(tempDir, LINT_TSCONFIG_FILENAME),
    JSON.stringify(tsconfig, null, 2),
    'utf8',
  );
}

interface ReadableLike {
  on(
    event: 'data',
    listener: (chunk: { toString(encoding: string): string }) => void,
  ): unknown;
}

interface ChildProcessLike {
  stdout: ReadableLike;
  stderr: ReadableLike;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(signal?: string): boolean;
}

async function spawnCapture(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number = SPAWN_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let child = spawn(bin, args, {
      cwd,
      shell: false,
    }) as unknown as ChildProcessLike;
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Kill-on-timeout so a hung child-process can't stall the bot-runner
    // indefinitely. SIGTERM first, then SIGKILL if it ignores SIGTERM.
    let timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore — may already be dead
      }
      // Give it 5s to shut down gracefully, then force-kill.
      setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 5_000);
      settle(
        null,
        new Error(
          `command timed out after ${timeoutMs}ms: ${bin} ${args.join(' ')}`,
        ),
      );
    }, timeoutMs);

    let settle = (
      result: { stdout: string; stderr: string; code: number | null } | null,
      err: Error | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else if (result) resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err: Error) => settle(null, err));
    child.on('close', (code: number | null) => {
      settle({ stdout, stderr, code }, null);
    });
  });
}

function sanitizeIdSegment(s: string): string {
  return (s || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40);
}

export async function cleanupOrphanedSubmissionTemps(): Promise<void> {
  await fs
    .rm(SUBMISSIONS_TEMP_ROOT, { recursive: true, force: true })
    .catch(() => {});
}
