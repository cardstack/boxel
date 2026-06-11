/**
 * Parse execution — shared engine used by both the validation pipeline's
 * `ParseValidationStep` (which writes a `ParseResult` card artifact) and the
 * in-memory `run_parse` agent tool (which returns results without side
 * effects).
 *
 * For `.gts` / `.gjs` / `.ts` files: runs glint (ember-tsc) for template-
 * aware TypeScript type checking.
 *
 * For `.json` files: validates JSON syntax via `JSON.parse()` and checks
 * card document structure (presence of `data.type` and `data.meta.adoptsFrom`).
 * Whole-realm JSON validation runs against spec `linkedExamples` — the same
 * discovery mechanism as the instantiate step.
 */

import { execFile } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { specRef } from '@cardstack/runtime-common/constants';

import { logger } from './logger';
import type { ParseErrorData, ParseFileResultData } from './parse-result-cards';
import { validateRealmRelativePath } from './realm-relative-path';
import { retryWithPoll } from './retry-with-poll';
import { readCard } from './workspace-fs';

import {
  cacheKeyForInputs,
  type ValidationRunCache,
} from './validation-run-cache';

let log = logger('parse-execution');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Extensions run through glint (ember-tsc). `.js` is excluded because lint
 * (ESLint) already validates JavaScript syntax and the factory agent does
 * not generate plain `.js` — it produces `.gts` for card definitions and
 * `.ts` for utility modules.
 */
export const PARSEABLE_GTS_EXTENSIONS = ['.gts', '.gjs', '.ts'];
export const PARSEABLE_JSON_EXTENSION = '.json';

/**
 * Monorepo layout assumption: this package lives at
 * `packages/software-factory`, alongside `packages/base`,
 * `packages/host`, and `packages/boxel-ui`.
 */
const PACKAGES_PATH = resolve(__dirname, '..', '..');
const BASE_PKG_PATH = join(PACKAGES_PATH, 'base');
const HOST_PKG_PATH = join(PACKAGES_PATH, 'host');

/**
 * Absolute path to the host package's node_modules. We symlink this (not
 * software-factory's node_modules) because the host has all the Ember/Glimmer
 * type declarations that realm .gts files import from.
 */
const NODE_MODULES_PATH = join(HOST_PKG_PATH, 'node_modules');

/** Cached tsconfig content — doesn't change between runs. */
let cachedTsconfigContent: string | undefined;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SpecExampleInfo {
  specId: string;
  exampleUrls: string[];
}

/** Flattened error — used by both validator details and in-memory. */
export interface ParseErrorViolation {
  file: string;
  line: number;
  message: string;
}

export interface DiscoverFilesOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to client.search-based spec discovery. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecExampleInfo[]; error?: string }>;
}

export interface ParseRealmFilesOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory to read source files from. The realm is
   * used for spec discovery (via `client.search`) but content comes from
   * disk.
   */
  workspaceDir: string;
  /** Injected for testing — defaults to reading from the workspace. */
  readFileFn?: (
    realmUrl: string,
    path: string,
  ) => Promise<{
    ok: boolean;
    content?: string;
    document?: { data: Record<string, unknown> };
    error?: string;
  }>;
  /**
   * Injected for testing — runs glint (ember-tsc) on .gts files.
   * Defaults to downloading files to a temp dir and running ember-tsc.
   */
  runGlintCheckFn?: (
    gtsFiles: { path: string; content: string }[],
  ) => Promise<ParseErrorData[]>;
  /**
   * When set, the engine run is memoized per workspace fingerprint + file
   * set, so the agent's mid-turn `run_parse` and the pipeline's parse step
   * don't both type-check the same unchanged files.
   */
  cache?: ValidationRunCache;
}

export interface ParseRealmFilesOutput {
  fileResults: ParseFileResultData[];
  /** All errors flattened across files. Parse has no warnings. */
  errorViolations: ParseErrorViolation[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// In-memory tool types
// ---------------------------------------------------------------------------

export interface RunParseInMemoryOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory to read source files from.
   */
  workspaceDir: string;
  /**
   * When set, parse only this realm-relative file instead of discovering all
   * parseable files. Useful for mid-turn self-validation right after writing
   * one file. The extension must be one of `.gts`, `.gjs`, `.ts`, or
   * `.json` — other paths return `status: 'error'` without calling the realm.
   *
   * For `.gts` / `.gjs` / `.ts`, the single file runs through glint for
   * template-aware type checking. For `.json`, the content is parsed and
   * the card document structure is validated.
   */
  path?: string;
  /** See {@link ParseRealmFilesOptions.cache}. */
  cache?: ValidationRunCache;
}

export interface RunParseError {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface RunParseResult {
  status: 'passed' | 'failed' | 'error';
  filesChecked: number;
  filesWithErrors: number;
  errorCount: number;
  durationMs: number;
  /**
   * Realm-relative parseable file paths that were inspected. For whole-realm
   * runs, includes the full discovered set (GTS + JSON examples). For
   * single-file runs, contains exactly the one path.
   */
  parseableFiles: string[];
  /** All errors across all files. */
  errors: RunParseError[];
  /** Set only when `status === 'error'`. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Public discovery
// ---------------------------------------------------------------------------

/**
 * Discover `.gts`, `.gjs`, and `.ts` files in the realm (including test
 * files). Returns an alphabetically-sorted list.
 */
export async function discoverParseableGtsFiles(
  options: Pick<
    DiscoverFilesOptions,
    'targetRealm' | 'client' | 'fetchFilenames'
  >,
): Promise<string[]> {
  let fetchFilenames =
    options.fetchFilenames ??
    ((realmUrl: string) => options.client.listFiles(realmUrl));

  let result = await fetchFilenames(options.targetRealm);
  if (result.error) {
    throw new Error(result.error);
  }

  return result.filenames
    .filter((f) => PARSEABLE_GTS_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Discover JSON example files via Spec cards and their `linkedExamples` —
 * same mechanism as the instantiate validation step. Returns realm-relative
 * paths alphabetically sorted and deduplicated.
 */
export async function discoverJsonExampleFiles(
  options: Pick<
    DiscoverFilesOptions,
    'targetRealm' | 'client' | 'searchSpecsFn'
  >,
): Promise<string[]> {
  let searchSpecsFn =
    options.searchSpecsFn ??
    ((realmUrl: string) => defaultSearchSpecs(options.client, realmUrl));

  // Realm-side source POST indexing is async, so a newly-uploaded Spec
  // card may not be in the search index by the time we get here. Bounded-
  // poll until even one spec shows up so an agent or test that just
  // pushed Spec files isn't penalized for indexing latency.
  let result = await retryWithPoll(
    () => searchSpecsFn(options.targetRealm),
    (r) => !r.error && r.specs.length === 0,
  );
  if (result.error) {
    log.warn(`Failed to discover specs for JSON validation: ${result.error}`);
    return [];
  }

  let urls: string[] = [];
  for (let spec of result.specs) {
    for (let url of spec.exampleUrls) {
      // Spec `linkedExamples` are normalized to fileless card IDs (no
      // extension). Append `.json` so the discovered list aligns with the
      // extension enforcement in single-file `path` mode — an agent can
      // take any entry from `parseableFiles` and feed it back into
      // `run_parse({ path })` verbatim.
      let normalized = url.endsWith(PARSEABLE_JSON_EXTENSION)
        ? url
        : `${url}${PARSEABLE_JSON_EXTENSION}`;
      if (!urls.includes(normalized)) {
        urls.push(normalized);
      }
    }
  }
  return urls.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Public engine
// ---------------------------------------------------------------------------

/**
 * Parse a set of discovered files. `.gts` / `.gjs` / `.ts` are batched into
 * a single glint invocation. JSON files are parsed in parallel and checked
 * for card document structure. Returns per-file results plus a flat list of
 * errors (parse has no warnings). Read failures surface as synthetic
 * `parse-error` entries.
 */
export async function parseRealmFiles(
  options: ParseRealmFilesOptions,
  gtsFiles: string[],
  jsonFiles: string[],
): Promise<ParseRealmFilesOutput> {
  if (options.cache) {
    let key = `parse:${cacheKeyForInputs([...gtsFiles, ...jsonFiles])}`;
    return options.cache.getOrRun(key, () =>
      parseRealmFilesUncached(options, gtsFiles, jsonFiles),
    );
  }
  return parseRealmFilesUncached(options, gtsFiles, jsonFiles);
}

async function parseRealmFilesUncached(
  options: ParseRealmFilesOptions,
  gtsFiles: string[],
  jsonFiles: string[],
): Promise<ParseRealmFilesOutput> {
  let readFileFn =
    options.readFileFn ??
    (async (_realmUrl: string, path: string) => {
      let result = await readCard(options.workspaceDir, path);
      return {
        ok: result.ok,
        content: result.content,
        document: result.document as
          | { data: Record<string, unknown> }
          | undefined,
        error: result.error,
      };
    });
  let runGlintCheckFn =
    options.runGlintCheckFn ?? ((files) => runGlintCheck(files));

  let startedAt = Date.now();
  let fileResults: ParseFileResultData[] = [];
  let errorViolations: ParseErrorViolation[] = [];

  if (gtsFiles.length > 0) {
    let gtsContents: { path: string; content: string }[] = [];
    for (let file of gtsFiles) {
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
        gtsContents.push({ path: file, content: readResult.content });
      } catch (err) {
        let message = `Read failed: ${err instanceof Error ? err.message : String(err)}`;
        log.warn(`Error reading ${file}: ${message}`);
        recordSyntheticError(file, message, fileResults, errorViolations);
      }
    }

    if (gtsContents.length > 0) {
      try {
        let glintErrors = await runGlintCheckFn(gtsContents);

        let errorsByFile = new Map<string, ParseErrorData[]>();
        for (let err of glintErrors) {
          let existing = errorsByFile.get(err.file) ?? [];
          existing.push(err);
          errorsByFile.set(err.file, existing);
        }

        for (let { path: file } of gtsContents) {
          let fileErrors = errorsByFile.get(file) ?? [];
          fileResults.push({ file, errors: fileErrors });
          for (let e of fileErrors) {
            errorViolations.push({
              file: e.file,
              line: e.line,
              message: e.message,
            });
          }
        }
      } catch (err) {
        let message = `Glint check failed: ${err instanceof Error ? err.message : String(err)}`;
        log.warn(message);
        // Report as a single error against the first file.
        let firstFile = gtsContents[0].path;
        recordSyntheticError(firstFile, message, fileResults, errorViolations);
      }
    }
  }

  if (jsonFiles.length > 0) {
    let jsonSettled = await Promise.allSettled(
      jsonFiles.map(async (jsonUrl) => {
        let readResult = await readFileFn(options.targetRealm, jsonUrl);
        if (!readResult.ok) {
          return {
            file: jsonUrl,
            errors: [
              {
                file: jsonUrl,
                line: 0,
                column: 0,
                message: `Could not read ${jsonUrl}: ${readResult.error ?? 'read failed'}`,
              },
            ] as ParseErrorData[],
          };
        }

        let errors: ParseErrorData[];
        if (readResult.document) {
          errors = validateCardDocumentStructure(jsonUrl, readResult.document);
        } else if (readResult.content != null) {
          errors = parseJsonFile(jsonUrl, readResult.content);
        } else {
          errors = [
            {
              file: jsonUrl,
              line: 0,
              column: 0,
              message: `Could not read ${jsonUrl}: no content or document`,
            },
          ];
        }
        return { file: jsonUrl, errors };
      }),
    );

    for (let i = 0; i < jsonSettled.length; i++) {
      let outcome = jsonSettled[i];
      let jsonUrl = jsonFiles[i];
      if (outcome.status === 'fulfilled') {
        fileResults.push(outcome.value);
        for (let e of outcome.value.errors) {
          errorViolations.push({
            file: e.file,
            line: e.line,
            message: e.message,
          });
        }
      } else {
        let message = `Parse failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`;
        log.warn(`Error parsing ${jsonUrl}: ${message}`);
        recordSyntheticError(jsonUrl, message, fileResults, errorViolations);
      }
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
 * Parse the realm and return a flat, JSON-friendly result. Unlike
 * `ParseValidationStep`, this does NOT create or update a `ParseResult`
 * card — the result is consumed by the agent directly for mid-turn
 * self-validation.
 *
 * Without `path`, discovers every `.gts` / `.gjs` / `.ts` file in the realm
 * and every `.json` file listed as a Spec `linkedExamples` entry. With
 * `path`, parses only that single file.
 */
export async function runParseInMemory(
  options: RunParseInMemoryOptions,
): Promise<RunParseResult> {
  let gtsFiles: string[] = [];
  let jsonFiles: string[] = [];

  if (options.path) {
    let path = options.path;
    let pathError = validateRealmRelativePath(path);
    if (pathError) {
      return emptyErrorResult(pathError);
    }
    if (PARSEABLE_GTS_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      gtsFiles = [path];
    } else if (path.endsWith(PARSEABLE_JSON_EXTENSION)) {
      jsonFiles = [path];
    } else {
      return emptyErrorResult(
        `Path "${path}" is not parseable — must end with one of ${PARSEABLE_GTS_EXTENSIONS.join(', ')}, or ${PARSEABLE_JSON_EXTENSION}`,
      );
    }
  } else {
    try {
      [gtsFiles, jsonFiles] = await Promise.all([
        discoverParseableGtsFiles({
          targetRealm: options.targetRealm,
          client: options.client,
        }),
        discoverJsonExampleFiles({
          targetRealm: options.targetRealm,
          client: options.client,
        }),
      ]);
    } catch (err) {
      return emptyErrorResult(
        `Failed to discover parseable files: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let parseableFiles = [...gtsFiles, ...jsonFiles];

  if (parseableFiles.length === 0) {
    return {
      status: 'passed',
      filesChecked: 0,
      filesWithErrors: 0,
      errorCount: 0,
      durationMs: 0,
      parseableFiles: [],
      errors: [],
    };
  }

  try {
    let { fileResults, durationMs } = await parseRealmFiles(
      {
        targetRealm: options.targetRealm,
        client: options.client,
        workspaceDir: options.workspaceDir,
        cache: options.cache,
      },
      gtsFiles,
      jsonFiles,
    );

    let errors: RunParseError[] = [];
    let filesWithErrors = 0;
    for (let fr of fileResults) {
      if (fr.errors.length > 0) filesWithErrors += 1;
      for (let e of fr.errors) {
        errors.push({
          file: e.file,
          line: e.line,
          column: e.column,
          message: e.message,
        });
      }
    }

    return {
      status: errors.length === 0 ? 'passed' : 'failed',
      filesChecked: fileResults.length,
      filesWithErrors,
      errorCount: errors.length,
      durationMs,
      parseableFiles,
      errors,
    };
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`runParseInMemory error: ${errorMessage}`);
    return {
      status: 'error',
      filesChecked: 0,
      filesWithErrors: 0,
      errorCount: 0,
      durationMs: 0,
      parseableFiles,
      errors: [],
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Glint (ember-tsc) type checking
// ---------------------------------------------------------------------------

/**
 * Run `ember-tsc --noEmit` on .gts files to get glint type errors.
 *
 * 1. Creates a temp directory with the .gts files
 * 2. Writes a tsconfig.json with paths mapping `https://cardstack.com/base/*`
 *    to the monorepo's `packages/base` directory (same as `realm/tsconfig.json`)
 * 3. Runs `ember-tsc --noEmit --project <tsconfig>`
 * 4. Parses the output for errors originating from the temp directory
 * 5. Maps errors back to original realm file paths
 */
export async function runGlintCheck(
  files: { path: string; content: string }[],
): Promise<ParseErrorData[]> {
  let tempDir = mkdtempSync(join(tmpdir(), 'sf-parse-'));

  try {
    for (let file of files) {
      let normalized = join(tempDir, file.path);
      let resolved = resolve(normalized);
      if (!resolved.startsWith(tempDir + '/')) {
        log.warn(
          `Skipping file with unsafe path: ${file.path} (resolves outside temp dir)`,
        );
        continue;
      }
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, file.content, 'utf8');
    }

    if (!cachedTsconfigContent) {
      let tsconfig = {
        compilerOptions: {
          target: 'es2022',
          allowJs: true,
          moduleResolution: 'bundler',
          allowSyntheticDefaultImports: true,
          noEmit: true,
          baseUrl: '.',
          module: 'es2022',
          strict: true,
          experimentalDecorators: true,
          skipLibCheck: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          types: ['qunit-dom', '@cardstack/local-types'],
          paths: {
            'https://cardstack.com/base/*': [`${BASE_PKG_PATH}/*`],
            '@cardstack/host/tests/*': [`${HOST_PKG_PATH}/tests/*`],
            '@cardstack/host/*': [`${HOST_PKG_PATH}/app/*`],
            '@cardstack/boxel-host/commands/*': [
              `${HOST_PKG_PATH}/app/commands/*`,
            ],
            '@cardstack/boxel-ui/*': [
              `${join(PACKAGES_PATH, 'boxel-ui', 'addon', 'src')}/*`,
            ],
            '*': [`${HOST_PKG_PATH}/types/*`],
          },
        },
        include: ['**/*.ts', '**/*.gts', '**/*.gjs'],
        exclude: ['node_modules'],
      };
      cachedTsconfigContent = JSON.stringify(tsconfig, null, 2);
    }
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      cachedTsconfigContent,
      'utf8',
    );

    symlinkSync(NODE_MODULES_PATH, join(tempDir, 'node_modules'));

    let emberTscBin = resolve(
      __dirname,
      '..',
      'node_modules',
      '.bin',
      'ember-tsc',
    );
    let { output, exitedWithError } = await new Promise<{
      output: string;
      exitedWithError: boolean;
    }>((resolvePromise, reject) => {
      let child = execFile(
        emberTscBin,
        ['--noEmit', '--project', join(tempDir, 'tsconfig.json')],
        {
          cwd: tempDir,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && !stdout && !stderr) {
            reject(new Error(`ember-tsc execution failed: ${error.message}`));
            return;
          }
          if (child.killed || error?.killed) {
            reject(new Error('ember-tsc was killed (timeout or signal)'));
            return;
          }
          resolvePromise({
            output: stdout + stderr,
            exitedWithError: !!error,
          });
        },
      );
    });

    let errors: ParseErrorData[] = [];
    let totalDiagnosticLines = 0;
    let lines = output.split('\n');

    for (let line of lines) {
      let match = line.match(
        /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/,
      );
      if (!match) {
        continue;
      }

      totalDiagnosticLines++;

      let [, filePath, lineStr, colStr, tsCode, message] = match;

      let absolutePath = resolve(tempDir, filePath);
      if (!absolutePath.startsWith(tempDir)) {
        continue;
      }

      if (tsCode === 'TS2353' && message.includes("'scoped'")) {
        continue;
      }

      let realmPath = absolutePath.slice(tempDir.length + 1);
      let originalFile = files.find((f) => f.path === realmPath);
      if (!originalFile) {
        continue;
      }

      errors.push({
        file: originalFile.path,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        message,
      });
    }

    if (exitedWithError && errors.length === 0 && totalDiagnosticLines === 0) {
      let truncatedOutput = output.slice(0, 500).trim();
      errors.push({
        file: files[0]?.path ?? 'unknown',
        line: 0,
        column: 0,
        message: `ember-tsc exited with errors but produced no TS diagnostics. This is likely a bug in the parse validation setup (not in the card code) — check that the tsconfig paths and node_modules symlink are correct. Output: ${truncatedOutput}`,
      });
    }

    return errors;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      log.warn(`Failed to clean up temp dir: ${tempDir}`);
    }
  }
}

// ---------------------------------------------------------------------------
// JSON validation
// ---------------------------------------------------------------------------

/**
 * Parse a JSON file and validate card document structure.
 */
export function parseJsonFile(
  filename: string,
  source: string,
): ParseErrorData[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    return [
      {
        file: filename,
        line: 0,
        column: 0,
        message: `Invalid JSON: ${message}`,
      },
    ];
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [
      {
        file: filename,
        line: 0,
        column: 0,
        message: 'Card document must be a JSON object',
      },
    ];
  }

  return validateCardDocumentStructure(
    filename,
    parsed as { data: Record<string, unknown> },
  );
}

/**
 * Validate card document structure from an already-parsed object.
 */
export function validateCardDocumentStructure(
  filename: string,
  doc: { data: Record<string, unknown> },
): ParseErrorData[] {
  let errors: ParseErrorData[] = [];
  let data = doc.data;

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    errors.push({
      file: filename,
      line: 0,
      column: 0,
      message: 'Card document must have a "data" object',
    });
    return errors;
  }

  let dataObj = data as Record<string, unknown>;

  if (typeof dataObj.type !== 'string') {
    errors.push({
      file: filename,
      line: 0,
      column: 0,
      message: 'Card document "data.type" must be a string',
    });
  }

  let meta = dataObj.meta as Record<string, unknown> | undefined;
  if (typeof meta !== 'object' || meta === null) {
    errors.push({
      file: filename,
      line: 0,
      column: 0,
      message: 'Card document must have a "data.meta" object',
    });
  } else {
    let adoptsFrom = meta.adoptsFrom as Record<string, unknown> | undefined;
    if (typeof adoptsFrom !== 'object' || adoptsFrom === null) {
      errors.push({
        file: filename,
        line: 0,
        column: 0,
        message:
          'Card document must have a "data.meta.adoptsFrom" object with "module" and "name"',
      });
    } else {
      if (typeof adoptsFrom.module !== 'string') {
        errors.push({
          file: filename,
          line: 0,
          column: 0,
          message: '"data.meta.adoptsFrom.module" must be a string',
        });
      }
      if (typeof adoptsFrom.name !== 'string') {
        errors.push({
          file: filename,
          line: 0,
          column: 0,
          message: '"data.meta.adoptsFrom.name" must be a string',
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Default spec search
// ---------------------------------------------------------------------------

/**
 * Default spec discovery: search the realm for Spec cards and extract
 * linkedExamples URLs. Same pattern as InstantiateValidationStep.
 */
async function defaultSearchSpecs(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<{ specs: SpecExampleInfo[]; error?: string }> {
  let searchResult = await client.search(realmUrl, {
    filter: {
      type: specRef,
    },
  });

  if (!searchResult.ok) {
    return { specs: [], error: searchResult.error };
  }

  let specs: SpecExampleInfo[] = [];
  for (let card of searchResult.data ?? []) {
    let specId = (card as Record<string, unknown>).id as string | undefined;
    if (!specId) {
      continue;
    }

    let attributes = (card as Record<string, unknown>).attributes as
      | Record<string, unknown>
      | undefined;
    if (!attributes) {
      continue;
    }

    let specType = attributes.specType as string | undefined;
    if (specType === 'field') {
      continue;
    }

    let relationships = (card as Record<string, unknown>).relationships as
      | Record<string, unknown>
      | undefined;
    let rawExampleUrls = extractLinkedExamples(relationships);
    let specCardUrl = new URL(specId, ensureTrailingSlash(realmUrl)).href;
    let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
    let exampleUrls: string[] = [];
    for (let rawUrl of rawExampleUrls) {
      let absoluteUrl = new URL(rawUrl, specCardUrl).href;
      if (absoluteUrl.startsWith(normalizedRealmUrl)) {
        exampleUrls.push(absoluteUrl.slice(normalizedRealmUrl.length));
      }
    }

    specs.push({ specId, exampleUrls });
  }

  return { specs };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordReadError(
  file: string,
  detail: string,
  fileResults: ParseFileResultData[],
  errorViolations: ParseErrorViolation[],
): void {
  let message = `Could not read ${file}: ${detail}`;
  log.warn(message);
  recordSyntheticError(file, message, fileResults, errorViolations);
}

function recordSyntheticError(
  file: string,
  message: string,
  fileResults: ParseFileResultData[],
  errorViolations: ParseErrorViolation[],
): void {
  fileResults.push({
    file,
    errors: [{ file, line: 0, column: 0, message }],
  });
  errorViolations.push({ file, line: 0, message });
}

function emptyErrorResult(errorMessage: string): RunParseResult {
  return {
    status: 'error',
    filesChecked: 0,
    filesWithErrors: 0,
    errorCount: 0,
    durationMs: 0,
    parseableFiles: [],
    errors: [],
    errorMessage,
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Extract all `linkedExamples` relationship URLs from a card's
 * relationships. Boxel encodes `linksToMany` with dotted keys.
 */
function extractLinkedExamples(
  relationships: Record<string, unknown> | undefined,
): string[] {
  if (!relationships) {
    return [];
  }

  let urls: string[] = [];

  for (let i = 0; ; i++) {
    let entry = relationships[`linkedExamples.${i}`] as
      | { links?: { self?: string } }
      | undefined;
    if (!entry?.links?.self) {
      break;
    }
    urls.push(entry.links.self);
  }

  if (urls.length === 0) {
    let examples = relationships['linkedExamples'] as
      | { links?: { self?: string } }
      | undefined;
    if (examples?.links?.self) {
      urls.push(examples.links.self);
    }
  }

  return urls;
}
