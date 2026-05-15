import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager';
import { FG_RED, DIM, RESET } from '../lib/colors';
import { cliLog } from '../lib/cli-log';
import { search } from './search';

/**
 * Inlined to avoid cascading the runtime-common index's URL-style
 * imports (`https://cardstack.com/base/*`) into boxel-cli's
 * tsconfig, which doesn't carry the monorepo path mappings the
 * factory's tsconfig does. Equivalent to `specRef` in
 * `@cardstack/runtime-common/constants`.
 */
const SPEC_TYPE = {
  module: 'https://cardstack.com/base/spec',
  name: 'Spec',
} as const;

/**
 * `boxel parse` runs glint (`ember-tsc`) over `.gts` / `.gjs` / `.ts`
 * files in a realm and validates the document structure of any
 * `.json` files linked as `Spec.linkedExamples`. Source is fetched
 * from the realm; type-checking happens locally.
 *
 * Path resolution assumes a Boxel monorepo layout — `packages/base`,
 * `packages/host`, `packages/boxel-ui`, and `@glint/ember-tsc` are
 * discovered relative to this file. The published CLI installed
 * outside the monorepo will not be able to run this command (the
 * binary won't be present and the type-path mappings won't resolve);
 * `boxel parse` is a factory-developer tool, not an end-user one.
 *
 * Lifted from `packages/software-factory/src/parse-execution.ts`
 * during CS-11149 so the same engine is reachable from a
 * subscription-billed Claude Code session via Bash.
 */

const PARSEABLE_GTS_EXTENSIONS = ['.gts', '.gjs', '.ts'] as const;
const PARSEABLE_JSON_EXTENSION = '.json';

/**
 * Monorepo layout: this file lives at
 * `packages/boxel-cli/src/commands/parse.ts`. Up three levels reaches
 * `packages/`, alongside `base`, `host`, `boxel-ui`, etc.
 */
const PACKAGES_PATH = resolve(__dirname, '..', '..', '..');
const BASE_PKG_PATH = join(PACKAGES_PATH, 'base');
const HOST_PKG_PATH = join(PACKAGES_PATH, 'host');
const BOXEL_UI_PATH = join(PACKAGES_PATH, 'boxel-ui', 'addon', 'src');
const NODE_MODULES_PATH = join(HOST_PKG_PATH, 'node_modules');

let cachedTsconfigContent: string | undefined;

export interface ParseError {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface ParseRealmResult {
  status: 'passed' | 'failed' | 'error';
  filesChecked: number;
  filesWithErrors: number;
  errorCount: number;
  durationMs: number;
  parseableFiles: string[];
  errors: ParseError[];
  errorMessage?: string;
}

export interface ParseRealmOptions {
  /**
   * Optional realm-relative path. When set, parses only this file.
   * `.gts` / `.gjs` / `.ts` paths run through glint;
   * `.json` paths are validated for card document structure.
   */
  path?: string;
  profileManager?: ProfileManager;
}

interface SpecExampleInfo {
  specId: string;
  exampleUrls: string[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function parseRealm(
  realmUrl: string,
  options?: ParseRealmOptions,
): Promise<ParseRealmResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return emptyErrorResult(NO_ACTIVE_PROFILE_ERROR);
  }

  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
  let startedAt = Date.now();

  let gtsFiles: string[] = [];
  let jsonFiles: string[] = [];

  if (options?.path) {
    let path = options.path;
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
        discoverParseableGtsFiles(normalizedRealmUrl, pm),
        discoverJsonExampleFiles(normalizedRealmUrl, pm),
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
      durationMs: Date.now() - startedAt,
      parseableFiles: [],
      errors: [],
    };
  }

  let errors: ParseError[] = [];
  let filesWithErrors = new Set<string>();

  if (gtsFiles.length > 0) {
    let gtsContents: { path: string; content: string }[] = [];
    for (let file of gtsFiles) {
      let readResult = await fetchSource(normalizedRealmUrl, file, pm);
      if (!readResult.ok) {
        errors.push({
          file,
          line: 0,
          column: 0,
          message: `Could not read ${file}: ${readResult.error}`,
        });
        filesWithErrors.add(file);
        continue;
      }
      gtsContents.push({ path: file, content: readResult.content });
    }

    if (gtsContents.length > 0) {
      try {
        let glintErrors = await runGlintCheck(gtsContents);
        for (let e of glintErrors) {
          errors.push(e);
          filesWithErrors.add(e.file);
        }
      } catch (err) {
        let firstFile = gtsContents[0].path;
        errors.push({
          file: firstFile,
          line: 0,
          column: 0,
          message: `Glint check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        filesWithErrors.add(firstFile);
      }
    }
  }

  for (let jsonUrl of jsonFiles) {
    let readResult = await fetchSource(normalizedRealmUrl, jsonUrl, pm);
    if (!readResult.ok) {
      errors.push({
        file: jsonUrl,
        line: 0,
        column: 0,
        message: `Could not read ${jsonUrl}: ${readResult.error}`,
      });
      filesWithErrors.add(jsonUrl);
      continue;
    }
    let jsonErrors = parseJsonFile(jsonUrl, readResult.content);
    for (let e of jsonErrors) {
      errors.push(e);
      filesWithErrors.add(e.file);
    }
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    filesChecked: parseableFiles.length,
    filesWithErrors: filesWithErrors.size,
    errorCount: errors.length,
    durationMs: Date.now() - startedAt,
    parseableFiles,
    errors,
  };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function discoverParseableGtsFiles(
  realmUrl: string,
  pm: ProfileManager,
): Promise<string[]> {
  let mtimesUrl = `${realmUrl}_mtimes`;
  let response = await pm.authedRealmFetch(mtimesUrl, {
    method: 'GET',
    headers: { Accept: SupportedMimeType.Mtimes },
  });
  if (!response.ok) {
    let body = await response.text().catch(() => '(no body)');
    throw new Error(
      `_mtimes returned HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  let json = (await response.json()) as {
    data?: { attributes?: { mtimes?: Record<string, number> } };
  };
  let mtimes =
    json?.data?.attributes?.mtimes ??
    (json as unknown as Record<string, number>);

  let filenames: string[] = [];
  for (let fullUrl of Object.keys(mtimes)) {
    if (!fullUrl.startsWith(realmUrl)) continue;
    let relativePath = fullUrl.slice(realmUrl.length);
    if (!relativePath || relativePath.endsWith('/')) continue;
    if (PARSEABLE_GTS_EXTENSIONS.some((ext) => relativePath.endsWith(ext))) {
      filenames.push(relativePath);
    }
  }
  return filenames.sort();
}

async function discoverJsonExampleFiles(
  realmUrl: string,
  pm: ProfileManager,
): Promise<string[]> {
  let searchResult = await search(
    realmUrl,
    { filter: { type: SPEC_TYPE } },
    { profileManager: pm },
  );
  if (!searchResult.ok) {
    return [];
  }

  let specs: SpecExampleInfo[] = [];
  for (let card of searchResult.data ?? []) {
    let specId = (card as Record<string, unknown>).id as string | undefined;
    if (!specId) continue;

    let attributes = (card as Record<string, unknown>).attributes as
      | Record<string, unknown>
      | undefined;
    if (!attributes) continue;
    let specType = attributes.specType as string | undefined;
    if (specType === 'field') continue;

    let relationships = (card as Record<string, unknown>).relationships as
      | Record<string, unknown>
      | undefined;
    let rawExampleUrls = extractLinkedExamples(relationships);
    let specCardUrl = new URL(specId, realmUrl).href;
    let exampleUrls: string[] = [];
    for (let rawUrl of rawExampleUrls) {
      let absoluteUrl = new URL(rawUrl, specCardUrl).href;
      if (absoluteUrl.startsWith(realmUrl)) {
        exampleUrls.push(absoluteUrl.slice(realmUrl.length));
      }
    }
    specs.push({ specId, exampleUrls });
  }

  let urls: string[] = [];
  for (let spec of specs) {
    for (let url of spec.exampleUrls) {
      let normalized = url.endsWith(PARSEABLE_JSON_EXTENSION)
        ? url
        : `${url}${PARSEABLE_JSON_EXTENSION}`;
      if (!urls.includes(normalized)) urls.push(normalized);
    }
  }
  return urls.sort();
}

function extractLinkedExamples(
  relationships: Record<string, unknown> | undefined,
): string[] {
  if (!relationships) return [];
  let urls: string[] = [];
  for (let i = 0; ; i++) {
    let entry = relationships[`linkedExamples.${i}`] as
      | { links?: { self?: string } }
      | undefined;
    if (!entry?.links?.self) break;
    urls.push(entry.links.self);
  }
  if (urls.length === 0) {
    let examples = relationships['linkedExamples'] as
      | { links?: { self?: string } }
      | undefined;
    if (examples?.links?.self) urls.push(examples.links.self);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Source reading
// ---------------------------------------------------------------------------

async function fetchSource(
  realmUrl: string,
  path: string,
  pm: ProfileManager,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    let readUrl = new URL(path, realmUrl).href;
    let response = await pm.authedRealmFetch(readUrl, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      let body = await response.text().catch(() => '(no body)');
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }
    return { ok: true, content: await response.text() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Glint (ember-tsc) type checking
// ---------------------------------------------------------------------------

/**
 * Run `ember-tsc --noEmit` against a set of `.gts` / `.gjs` / `.ts`
 * files in a temp dir. Symlinks the host package's node_modules and
 * writes a tsconfig with the same monorepo path mappings the realm
 * uses at runtime, then parses TS diagnostics from stdout.
 */
async function runGlintCheck(
  files: { path: string; content: string }[],
): Promise<ParseError[]> {
  let tempDir = mkdtempSync(join(tmpdir(), 'boxel-parse-'));

  try {
    for (let file of files) {
      let normalized = join(tempDir, file.path);
      let resolved = resolve(normalized);
      if (!resolved.startsWith(tempDir + '/')) continue;
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
            '@cardstack/boxel-ui/*': [`${BOXEL_UI_PATH}/*`],
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

    let errors: ParseError[] = [];
    let totalDiagnosticLines = 0;
    for (let line of output.split('\n')) {
      let match = line.match(
        /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/,
      );
      if (!match) continue;

      totalDiagnosticLines++;

      let [, filePath, lineStr, colStr, tsCode, message] = match;
      let absolutePath = resolve(tempDir, filePath);
      if (!absolutePath.startsWith(tempDir)) continue;

      if (tsCode === 'TS2353' && message.includes("'scoped'")) continue;

      let realmPath = absolutePath.slice(tempDir.length + 1);
      let originalFile = files.find((f) => f.path === realmPath);
      if (!originalFile) continue;

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
        message: `ember-tsc exited with errors but produced no TS diagnostics. Check the tsconfig paths and node_modules symlink. Output: ${truncatedOutput}`,
      });
    }

    return errors;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// JSON document validation
// ---------------------------------------------------------------------------

function parseJsonFile(filename: string, source: string): ParseError[] {
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

function validateCardDocumentStructure(
  filename: string,
  doc: { data: Record<string, unknown> },
): ParseError[] {
  let errors: ParseError[] = [];
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
// Helpers
// ---------------------------------------------------------------------------

function emptyErrorResult(message: string): ParseRealmResult {
  return {
    status: 'error',
    filesChecked: 0,
    filesWithErrors: 0,
    errorCount: 0,
    durationMs: 0,
    parseableFiles: [],
    errors: [],
    errorMessage: message,
  };
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

interface ParseCliOptions {
  realm: string;
  json?: boolean;
}

export function registerParseCommand(program: Command): void {
  program
    .command('parse')
    .description(
      "Type-check every .gts / .gjs / .ts file in a realm with glint, plus validate the document structure of any .json files linked as Spec.linkedExamples. Pass a realm-relative path to parse a single file. Monorepo-only (relies on packages/base, packages/host, packages/boxel-ui, and @glint/ember-tsc resolvable from this CLI's location).",
    )
    .argument(
      '[path]',
      'Optional realm-relative file path. When omitted, parses every parseable file (gts/gjs/ts + Spec linkedExamples JSON) in the realm.',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to parse against')
    .option('--json', 'Output structured JSON result')
    .action(async (path: string | undefined, opts: ParseCliOptions) => {
      let result: ParseRealmResult;
      try {
        result = await parseRealm(opts.realm, path ? { path } : {});
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

      if (result.errors.length === 0) {
        console.log(
          `${DIM}No parse errors (${result.filesChecked} file(s) checked).${RESET}`,
        );
        return;
      }

      let currentFile: string | undefined;
      for (let e of result.errors) {
        if (e.file !== currentFile) {
          currentFile = e.file;
          console.log(`\n${DIM}${e.file}${RESET}`);
        }
        console.log(
          `  ${FG_RED}error${RESET} ${e.line}:${e.column} ${e.message}`,
        );
      }

      console.log(
        `\n${DIM}${result.errorCount} error(s) across ${result.filesWithErrors} of ${result.filesChecked} file(s)${RESET}`,
      );

      if (result.errorCount > 0) {
        process.exit(1);
      }
    });
}
