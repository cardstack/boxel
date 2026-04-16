/**
 * Parse validation step — verifies that `.gts` and `.json` files in the
 * target realm are syntactically valid using glint (ember-tsc) for
 * template-aware TypeScript type checking.
 *
 * For `.gts` files: downloads them to a temp directory along with the
 * tsconfig.json from the software-factory realm, then runs `ember-tsc
 * --noEmit` which performs full glint type checking — catching both
 * TypeScript type errors AND template errors (invalid component args,
 * missing helpers, bad template expressions, etc.).
 *
 * For `.json` files: validates JSON syntax via `JSON.parse()` and checks
 * card document structure (presence of `data.type` and `data.meta.adoptsFrom`).
 * JSON validation runs against spec `linkedExamples` — the same discovery
 * mechanism as the instantiate step — so it validates the example instances
 * that the factory agent creates alongside card definitions.
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

import { specRef } from '@cardstack/runtime-common/constants';

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent-types';

import {
  fetchRealmFilenames,
  getNextValidationSequenceNumber,
  readFile,
  searchRealm,
  type RealmFetchOptions,
} from '../realm-operations';
import {
  createParseResult,
  completeParseResult,
  type ParseFileResultData,
  type ParseErrorData,
} from '../parse-result-cards';
import { logger } from '../logger';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('parse-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParseValidationStepConfig {
  authorization?: string;
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  parseResultsModuleUrl: string;
  issueId?: string;
  /** Injected for testing — defaults to fetchRealmFilenames. */
  fetchFilenames?: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to readFile from realm-operations. */
  readFileFn?: (
    realmUrl: string,
    path: string,
    options?: RealmFetchOptions,
  ) => Promise<{
    ok: boolean;
    content?: string;
    document?: { data: Record<string, unknown> };
    error?: string;
  }>;
  /** Injected for testing — defaults to searchRealm-based spec discovery. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecExampleInfo[]; error?: string }>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;
  /**
   * Injected for testing — runs glint (ember-tsc) on .gts files.
   * Defaults to downloading files to a temp dir and running ember-tsc.
   */
  runGlintCheckFn?: (
    gtsFiles: { path: string; content: string }[],
  ) => Promise<ParseErrorData[]>;
}

export interface SpecExampleInfo {
  specId: string;
  exampleUrls: string[];
}

/** Flattened POJO for parse validation details — not a card, just data. */
export interface ParseValidationDetails {
  parseResultId: string;
  filesChecked: number;
  filesWithErrors: number;
  totalErrors: number;
  errors: { file: string; line: number; message: string }[];
}

/**
 * Extensions checked by the parse step. `.js` files are excluded because
 * lint (ESLint) already validates JavaScript syntax and the factory agent
 * does not generate plain `.js` — it produces `.gts` for card definitions
 * and `.ts` for utility modules.
 */
const PARSEABLE_EXTENSIONS = ['.gts', '.gjs', '.ts'];

/**
 * Monorepo layout assumptions: the software-factory package lives at
 * `packages/software-factory` alongside `packages/base`, `packages/host`,
 * and `packages/boxel-ui`. These paths are used to construct the tsconfig
 * path mappings for ember-tsc. If the deployment model changes (e.g.,
 * packages are published independently), these will need to be
 * reconfigured — likely via config injection rather than hardcoded paths.
 */
const PACKAGES_PATH = resolve(__dirname, '..', '..', '..');
const BASE_PKG_PATH = join(PACKAGES_PATH, 'base');
const HOST_PKG_PATH = join(PACKAGES_PATH, 'host');

/**
 * Absolute path to the host package's node_modules. We symlink this (not
 * software-factory's node_modules) because the host has all the Ember/Glimmer
 * type declarations that realm .gts files import from (@ember/helper,
 * @ember/modifier, @glimmer/tracking, @cardstack/boxel-ui, etc.). These
 * modules are shimmed at runtime by the host app and have type declarations
 * resolved through ember-source's stable types in the host's dependency tree.
 *
 * NOTE: This assumes the software-factory package is co-located with the host
 * package in the monorepo. If we move to a different deployment model where
 * these packages are separated, the node_modules path and the tsconfig path
 * mappings below will need to be reconfigured.
 */
const NODE_MODULES_PATH = join(HOST_PKG_PATH, 'node_modules');

/** Cached tsconfig content — doesn't change between runs. */
let cachedTsconfigContent: string | undefined;

// ---------------------------------------------------------------------------
// ParseValidationStep
// ---------------------------------------------------------------------------

export class ParseValidationStep implements ValidationStepRunner {
  readonly step = 'parse' as const;

  private config: ParseValidationStepConfig;
  private lastSequenceNumber = 0;

  private fetchFilenamesFn: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  private readFileFn: (
    realmUrl: string,
    path: string,
    options?: RealmFetchOptions,
  ) => Promise<{
    ok: boolean;
    content?: string;
    document?: { data: Record<string, unknown> };
    error?: string;
  }>;
  private searchSpecsFn: (
    realmUrl: string,
  ) => Promise<{ specs: SpecExampleInfo[]; error?: string }>;
  private getNextSeqFn: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;
  private runGlintCheckFn: (
    gtsFiles: { path: string; content: string }[],
  ) => Promise<ParseErrorData[]>;

  constructor(config: ParseValidationStepConfig) {
    this.config = config;
    this.fetchFilenamesFn = config.fetchFilenames ?? fetchRealmFilenames;
    this.readFileFn = config.readFileFn ?? readFile;
    this.searchSpecsFn =
      config.searchSpecsFn ??
      ((realmUrl: string) => this.defaultSearchSpecs(realmUrl));
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealmUrl: string) =>
        getNextValidationSequenceNumber(
          slug,
          'Validations/parse_',
          config.parseResultsModuleUrl,
          'ParseResult',
          {
            targetRealmUrl,
            authorization: config.authorization,
            fetch: config.fetch,
          },
        ));
    this.runGlintCheckFn =
      config.runGlintCheckFn ?? ((files) => runGlintCheck(files));
  }

  async run(targetRealmUrl: string): Promise<ValidationStepResult> {
    // Step 1: Discover files to validate
    let gtsFiles: string[];
    let jsonExampleUrls: string[];
    try {
      let [gts, json] = await Promise.all([
        this.discoverGtsFiles(targetRealmUrl),
        this.discoverJsonExampleFiles(targetRealmUrl),
      ]);
      gtsFiles = gts;
      jsonExampleUrls = json;
    } catch (err) {
      return {
        step: 'parse',
        passed: false,
        errors: [
          {
            message: `Failed to discover files: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (gtsFiles.length === 0 && jsonExampleUrls.length === 0) {
      log.info('No parseable files found — nothing to validate');
      return { step: 'parse', passed: true, files: [], errors: [] };
    }

    log.info(
      `Found ${gtsFiles.length} GTS file(s) and ${jsonExampleUrls.length} JSON example(s) to parse`,
    );

    // Step 2: Create the ParseResult card (status: running)
    let slug = this.config.issueId
      ? deriveIssueSlug(this.config.issueId)
      : 'validation';

    let issueURL = this.config.issueId
      ? new URL(this.config.issueId, targetRealmUrl).href
      : undefined;

    let seq: number;
    try {
      let realmSeq = await this.getNextSeqFn(slug, targetRealmUrl);
      seq = Math.max(realmSeq, this.lastSequenceNumber + 1);
    } catch (err) {
      log.warn(
        `Failed to resolve sequence number, using floor: ${err instanceof Error ? err.message : String(err)}`,
      );
      seq = this.lastSequenceNumber + 1;
    }

    let parseResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createParseResult(
        slug,
        this.config.parseResultsModuleUrl,
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
          sequenceNumber: seq,
          issueURL,
        },
      );
      parseResultId = createResult.parseResultId;
      if (!createResult.created) {
        log.warn(
          `ParseResult card creation returned created: false: ${createResult.error ?? 'unknown'}`,
        );
      } else {
        artifactCreated = true;
        this.lastSequenceNumber = seq;
      }
    } catch (err) {
      log.warn(
        `Failed to create ParseResult card: ${err instanceof Error ? err.message : String(err)}`,
      );
      parseResultId = `Validations/parse_${slug}-${seq}`;
    }

    // Step 3: Parse each file
    let startedAt = Date.now();
    let allFileResults: ParseFileResultData[] = [];
    let allErrors: ParseValidationDetails['errors'] = [];
    let fetchOpts: RealmFetchOptions = {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    };

    // 3a: Run glint (ember-tsc) on GTS files
    if (gtsFiles.length > 0) {
      let gtsContents: { path: string; content: string }[] = [];
      for (let file of gtsFiles) {
        try {
          let readResult = await this.readFileFn(
            targetRealmUrl,
            file,
            fetchOpts,
          );
          if (!readResult.ok) {
            let message = `Could not read ${file}: ${readResult.error ?? 'read failed'}`;
            log.warn(message);
            allFileResults.push({
              file,
              errors: [{ file, line: 0, column: 0, message }],
            });
            allErrors.push({ file, line: 0, message });
            continue;
          }
          if (readResult.content == null) {
            let message = `Could not read ${file}: no content`;
            log.warn(message);
            allFileResults.push({
              file,
              errors: [{ file, line: 0, column: 0, message }],
            });
            allErrors.push({ file, line: 0, message });
            continue;
          }
          gtsContents.push({ path: file, content: readResult.content });
        } catch (err) {
          let message = `Read failed: ${err instanceof Error ? err.message : String(err)}`;
          log.warn(`Error reading ${file}: ${message}`);
          allFileResults.push({
            file,
            errors: [{ file, line: 0, column: 0, message }],
          });
          allErrors.push({ file, line: 0, message });
        }
      }

      // Run glint on all files at once (one ember-tsc invocation)
      if (gtsContents.length > 0) {
        try {
          let glintErrors = await this.runGlintCheckFn(gtsContents);

          // Group errors by file for the file results
          let errorsByFile = new Map<string, ParseErrorData[]>();
          for (let err of glintErrors) {
            let existing = errorsByFile.get(err.file) ?? [];
            existing.push(err);
            errorsByFile.set(err.file, existing);
          }

          // Build file results for each GTS file (including clean ones)
          for (let { path: file } of gtsContents) {
            let fileErrors = errorsByFile.get(file) ?? [];
            allFileResults.push({ file, errors: fileErrors });
            for (let e of fileErrors) {
              allErrors.push({
                file: e.file,
                line: e.line,
                message: e.message,
              });
            }
          }
        } catch (err) {
          let message = `Glint check failed: ${err instanceof Error ? err.message : String(err)}`;
          log.warn(message);
          // Report as a single error against the first file
          allFileResults.push({
            file: gtsContents[0].path,
            errors: [
              {
                file: gtsContents[0].path,
                line: 0,
                column: 0,
                message,
              },
            ],
          });
          allErrors.push({ file: gtsContents[0].path, line: 0, message });
        }
      }
    }

    // 3b: Parse JSON example files in parallel
    // readFile returns `.json` files as `document` (parsed object) not `content`
    // (raw string), since the realm API parses JSON before returning. When a
    // `document` is present, JSON syntax is already validated — we only need to
    // check card document structure. When raw `content` is present (e.g., from
    // mocks), we parse it ourselves.
    if (jsonExampleUrls.length > 0) {
      let jsonSettled = await Promise.allSettled(
        jsonExampleUrls.map(async (jsonUrl) => {
          let readResult = await this.readFileFn(
            targetRealmUrl,
            jsonUrl,
            fetchOpts,
          );
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
            errors = validateCardDocumentStructure(
              jsonUrl,
              readResult.document,
            );
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
        let jsonUrl = jsonExampleUrls[i];
        if (outcome.status === 'fulfilled') {
          allFileResults.push(outcome.value);
          for (let e of outcome.value.errors) {
            allErrors.push({ file: e.file, line: e.line, message: e.message });
          }
        } else {
          let message = `Parse failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`;
          log.warn(`Error parsing ${jsonUrl}: ${message}`);
          allFileResults.push({
            file: jsonUrl,
            errors: [{ file: jsonUrl, line: 0, column: 0, message }],
          });
          allErrors.push({ file: jsonUrl, line: 0, message });
        }
      }
    }

    let durationMs = Date.now() - startedAt;
    let passed = allErrors.length === 0;

    // Step 4: Complete the ParseResult card
    if (artifactCreated) {
      let completeResult = await completeParseResult(
        parseResultId,
        {
          status: passed ? 'passed' : 'failed',
          durationMs,
          fileResults: allFileResults,
        },
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
        },
      );
      if (!completeResult.updated) {
        log.warn(
          `Failed to complete ParseResult card ${parseResultId}: ${completeResult.error ?? 'unknown'}`,
        );
      }
    }

    // Step 5: Build result
    let details: ParseValidationDetails = {
      parseResultId,
      filesChecked: allFileResults.length,
      filesWithErrors: allFileResults.filter((fr) => fr.errors.length > 0)
        .length,
      totalErrors: allErrors.length,
      errors: allErrors,
    };

    let errors = allErrors.map((e) => ({
      file: e.file,
      message: `${e.file}${e.line ? `:${e.line}` : ''} ${e.message}`,
    }));

    return {
      step: 'parse',
      passed,
      files: [...gtsFiles, ...jsonExampleUrls],
      errors,
      details: details as unknown as Record<string, unknown>,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      let details = result.details as unknown as
        | ParseValidationDetails
        | undefined;
      if (details && details.filesChecked > 0) {
        return `## Parse Validation: PASSED\n${details.filesChecked} file(s) checked, no parse errors. (ParseResult: ${details.parseResultId})`;
      }
      return '';
    }

    let details = result.details as unknown as
      | ParseValidationDetails
      | undefined;
    if (!details) {
      let errorLines = result.errors.map((e) => `- ${e.message}`).join('\n');
      return `## Parse Validation: FAILED\n${errorLines}`;
    }

    let lines: string[] = [
      `## Parse Validation: FAILED`,
      `${details.filesChecked} file(s) checked, ${details.totalErrors} error(s) in ${details.filesWithErrors} file(s) (ParseResult: ${details.parseResultId})`,
    ];

    for (let error of details.errors) {
      lines.push(
        `  ${error.file}${error.line ? `:${error.line}` : ''} ${error.message}`,
      );
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Discover .gts, .gjs, and .ts files in the realm (including test files).
   */
  private async discoverGtsFiles(targetRealmUrl: string): Promise<string[]> {
    let result = await this.fetchFilenamesFn(targetRealmUrl, {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    return result.filenames
      .filter((f) => PARSEABLE_EXTENSIONS.some((ext) => f.endsWith(ext)))
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Discover JSON example files to validate by searching for Spec cards
   * and extracting their linkedExamples — same discovery as instantiate step.
   */
  private async discoverJsonExampleFiles(
    targetRealmUrl: string,
  ): Promise<string[]> {
    let result = await this.searchSpecsFn(targetRealmUrl);
    if (result.error) {
      log.warn(`Failed to discover specs for JSON validation: ${result.error}`);
      return [];
    }

    let urls: string[] = [];
    for (let spec of result.specs) {
      for (let url of spec.exampleUrls) {
        if (!urls.includes(url)) {
          urls.push(url);
        }
      }
    }
    return urls.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Default spec discovery: search the realm for Spec cards and extract
   * linkedExamples URLs. Same pattern as InstantiateValidationStep.
   */
  private async defaultSearchSpecs(
    realmUrl: string,
  ): Promise<{ specs: SpecExampleInfo[]; error?: string }> {
    let fetchOptions: RealmFetchOptions = {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    };

    let searchResult = await searchRealm(
      realmUrl,
      {
        filter: {
          type: specRef,
        },
      },
      fetchOptions,
    );

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

      // Skip field specs
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
async function runGlintCheck(
  files: { path: string; content: string }[],
): Promise<ParseErrorData[]> {
  let tempDir = mkdtempSync(join(tmpdir(), 'sf-parse-'));

  try {
    // Write files to temp dir preserving directory structure.
    // Sanitize paths to prevent directory traversal — realm file paths
    // should never contain '..' or be absolute.
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

    // Write tsconfig.json — mirrors realm/tsconfig.json but with absolute
    // paths to the base package. Relaxes unused-variable checks since the
    // factory agent's generated code may have legitimate unused locals during
    // incremental development. Cached because it never changes between runs.
    if (!cachedTsconfigContent) {
      let tsconfig = {
        compilerOptions: {
          target: 'es2022',
          allowJs: true,
          // 'bundler' resolution supports both path mappings and import.meta
          // (test files use `import.meta.url` for module URL resolution)
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
          // qunit-dom augments QUnit's Assert type with .dom() — loaded
          // globally in test setup, so we include it as a type reference
          types: ['qunit-dom', '@cardstack/local-types'],
          paths: {
            'https://cardstack.com/base/*': [`${BASE_PKG_PATH}/*`],
            // Host test helpers — target realm test files import from these
            '@cardstack/host/tests/*': [`${HOST_PKG_PATH}/tests/*`],
            '@cardstack/host/*': [`${HOST_PKG_PATH}/app/*`],
            '@cardstack/boxel-host/commands/*': [
              `${HOST_PKG_PATH}/app/commands/*`,
            ],
            '@cardstack/boxel-ui/*': [
              `${join(PACKAGES_PATH, 'boxel-ui', 'addon', 'src')}/*`,
            ],
            // Fallback: host's types/ directory provides type stubs for
            // addons that don't ship their own declarations
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

    // Symlink node_modules so ember-tsc can resolve @glint/ember-tsc/-private/dsl
    // and other glint internals needed for template-aware type checking.
    symlinkSync(NODE_MODULES_PATH, join(tempDir, 'node_modules'));

    // Run ember-tsc
    let emberTscBin = resolve(
      __dirname,
      '..',
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
          // ember-tsc exits non-zero when there are type errors (expected).
          // Distinguish that from real execution failures: ENOENT (binary
          // not found), signal kills, and timeouts produce no TS diagnostics
          // and should be surfaced as step failures.
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

    // Parse output: filter to errors from our temp dir files only
    // Format: <path>(line,col): error TS<code>: <message>
    let errors: ParseErrorData[] = [];
    let lines = output.split('\n');

    for (let line of lines) {
      // Match lines referencing files in our temp dir
      // The path may be relative (../../.../tmp/...) or absolute
      let match = line.match(
        /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/,
      );
      if (!match) {
        continue;
      }

      let [, filePath, lineStr, colStr, tsCode, message] = match;

      // Resolve the path and check if it's in our temp dir
      let absolutePath = resolve(tempDir, filePath);
      if (!absolutePath.startsWith(tempDir)) {
        // Error from base package or other dependency — skip
        continue;
      }

      // Skip known false positives:
      // TS2353 for 'scoped' on <style> — Ember's `<style scoped>` is valid
      // but the HTML type definitions don't include it
      if (tsCode === 'TS2353' && message.includes("'scoped'")) {
        continue;
      }

      // Map back to the original realm file path
      let realmPath = absolutePath.slice(tempDir.length + 1); // +1 for the '/'
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

    // Safety check: if ember-tsc exited non-zero but we parsed zero
    // diagnostics from our files, something went wrong (e.g., a runtime
    // crash, module loader failure). Report this as a failure so we don't
    // silently bypass parse validation.
    if (exitedWithError && errors.length === 0) {
      let truncatedOutput = output.slice(0, 500).trim();
      errors.push({
        file: files[0]?.path ?? 'unknown',
        line: 0,
        column: 0,
        message: `ember-tsc exited with errors but no diagnostics matched target files. This may indicate a runtime failure in the type checker. Output: ${truncatedOutput}`,
      });
    }

    return errors;
  } finally {
    // Clean up temp dir
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
// Utility
// ---------------------------------------------------------------------------

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
