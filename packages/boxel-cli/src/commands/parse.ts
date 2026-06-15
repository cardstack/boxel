import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { FG_RED, DIM, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';
import { findBoxelCliRoot } from '../lib/find-package-root.ts';
import { validateRealmRelativePath } from '../lib/realm-relative-path.ts';
import { search } from './search.ts';

/**
 * Inlined to avoid cascading the runtime-common index's URL-style
 * imports (`https://cardstack.com/base/*`) into boxel-cli's
 * tsconfig, which doesn't carry the monorepo path mappings the
 * factory's tsconfig does. Equivalent to `specRef` in
 * `@cardstack/runtime-common/constants`.
 */
const SPEC_TYPE = {
  module: '@cardstack/base/spec',
  name: 'Spec',
} as const;

/**
 * `boxel parse` runs glint (`ember-tsc`) over `.gts` / `.gjs` / `.ts`
 * files in a realm and validates the document structure of any
 * `.json` files linked as `Spec.linkedExamples`. Source is fetched
 * from the realm; type-checking happens locally.
 *
 * Type sources come from one of two places (CS-11165):
 *
 * - **Published install**: `bundled-types/` next to the CLI, populated
 *   by `scripts/build-types.ts` at release time from sibling monorepo
 *   packages. Lets `boxel parse` work outside the monorepo.
 * - **Monorepo dev** (`pnpm start`, before `pnpm build:types`): the
 *   sibling `packages/base`, `packages/host`, `packages/boxel-ui`.
 *
 * `@glint/ember-tsc`, `typescript`, and `content-tag` are runtime
 * dependencies (moved from devDependencies in CS-11165), so the
 * published `boxel-cli`'s own `node_modules` carries the binary.
 *
 * Lifted from `packages/software-factory/src/parse-execution.ts`
 * during CS-11149 so the same engine is reachable from a
 * subscription-billed Claude Code session via Bash.
 */

const PARSEABLE_GTS_EXTENSIONS = ['.gts', '.gjs', '.ts'] as const;
const PARSEABLE_JSON_EXTENSION = '.json';

const BOXEL_CLI_PATH = findBoxelCliRoot(__dirname);
const PACKAGES_PATH = resolve(BOXEL_CLI_PATH, '..');

// CS-11165: a published `@cardstack/boxel-cli` install vendors the type
// sources from sibling packages into `bundled-types/` (built by
// `scripts/build-types.ts`). Prefer those when present so parse works
// outside the monorepo. Fall back to the monorepo sibling layout for
// in-monorepo dev (`pnpm start`, before `pnpm build:types` has run).
const BUNDLED_TYPES_DIR = (() => {
  let candidate = join(BOXEL_CLI_PATH, 'bundled-types');
  if (existsSync(join(candidate, 'base'))) return candidate;
  return undefined;
})();

const BASE_PKG_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'base')
  : join(PACKAGES_PATH, 'base');
const HOST_APP_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'host-app')
  : join(PACKAGES_PATH, 'host', 'app');
const HOST_TESTS_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'host-tests')
  : join(PACKAGES_PATH, 'host', 'tests');
const HOST_TYPES_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'host-types')
  : join(PACKAGES_PATH, 'host', 'types');
const BOXEL_UI_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'boxel-ui')
  : join(PACKAGES_PATH, 'boxel-ui', 'addon', 'src');
const LOCAL_TYPES_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'local-types')
  : join(PACKAGES_PATH, 'local-types');
// Ambient module decls for paths boxel-cli doesn't ship full types
// for (e.g. `@cardstack/boxel-icons/*` — 130MB if shipped). Generated
// by `scripts/build-types.ts`. Only present in published / built
// installs; the monorepo-dev path resolves these naturally.
const SHIMS_PATH = BUNDLED_TYPES_DIR
  ? join(BUNDLED_TYPES_DIR, 'shims')
  : undefined;

// Node modules: in-monorepo, host has every transitive dep glint needs
// already installed. In a published install we don't ship host's
// node_modules, so we fall back to boxel-cli's own node_modules. That
// means a third-party import in card code only type-checks if the
// package is a runtime dependency of boxel-cli: `@glint/ember-tsc`,
// `typescript`, and `content-tag` (CS-11165), plus the packages card
// code itself commonly imports — `@glimmer/component` and
// `@glimmer/tracking` (CS-11509). Imports outside that set surface as
// "Cannot find module …" parse errors; the fix is adding the package
// as a boxel-cli dependency, not shimming it.
const NODE_MODULES_PATH = BUNDLED_TYPES_DIR
  ? join(BOXEL_CLI_PATH, 'node_modules')
  : join(PACKAGES_PATH, 'host', 'node_modules');

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
  /**
   * Local workspace dir to read files from instead of fetching over
   * HTTP from the realm. The factory's main use case (CS-11165): the
   * agent writes `.gts` files to a `mktemp -d` workspace, runs
   * `boxel parse --workspace <that-dir>` to type-check pre-sync, fixes
   * errors, and only pushes when clean. When set, `realmUrl` is
   * optional — pass it only if you also want Spec linkedExamples
   * discovered via the realm's search index for cross-checking JSON
   * instances on the realm. With no realmUrl, parse skips remote
   * Spec discovery and only validates the workspace's `.gts`/`.ts`
   * and any local `.json` files passed by `path`.
   */
  workspace?: string;
  profileManager?: ProfileManager;
}

interface SpecExampleInfo {
  specId: string;
  exampleUrls: string[];
}

/**
 * Bounded-poll an async attempt until `needsRetry` is false or the
 * deadline elapses. Used to absorb realm-side indexing latency when
 * we search for Specs immediately after a push.
 */
async function retryWithPoll<T>(
  attempt: () => Promise<T>,
  needsRetry: (result: T) => boolean,
  options: { totalWaitMs?: number; pollMs?: number } = {},
): Promise<T> {
  let totalWaitMs = options.totalWaitMs ?? 30_000;
  let pollMs = options.pollMs ?? 250;
  let deadline = Date.now() + totalWaitMs;
  let result = await attempt();
  while (needsRetry(result) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    result = await attempt();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function parseRealm(
  realmUrl: string | undefined,
  options?: ParseRealmOptions,
): Promise<ParseRealmResult> {
  // Default to local-file type-checking: read from the working dir
  // (or an explicit --workspace dir). Pass --realm to fetch source
  // over HTTP from a realm instead. Two modes; --realm wins if both.
  let useWorkspace = !realmUrl;
  let workspace =
    options?.workspace ?? (useWorkspace ? process.cwd() : undefined);

  if (useWorkspace && workspace && !safeIsDirectory(workspace)) {
    return emptyErrorResult(`workspace directory not found: ${workspace}`);
  }

  let pm = options?.profileManager ?? getProfileManager();
  // Only require an active profile when we're going to hit the realm.
  if (!useWorkspace) {
    let active = pm.getActiveProfile();
    if (!active) {
      return emptyErrorResult(NO_ACTIVE_PROFILE_ERROR);
    }
  }

  let normalizedRealmUrl = realmUrl ? ensureTrailingSlash(realmUrl) : '';
  let startedAt = Date.now();

  let gtsFiles: string[] = [];
  let jsonFiles: string[] = [];

  if (options?.path) {
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
  } else if (useWorkspace) {
    try {
      gtsFiles = discoverWorkspaceGtsFiles(workspace!);
      jsonFiles = discoverWorkspaceJsonInstanceFiles(workspace!);
    } catch (err) {
      return emptyErrorResult(
        `Failed to walk workspace ${workspace}: ${err instanceof Error ? err.message : String(err)}`,
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

  let readSource = (path: string) =>
    useWorkspace
      ? readWorkspaceSource(workspace!, path)
      : fetchSource(normalizedRealmUrl, path, pm);

  let errors: ParseError[] = [];
  let filesWithErrors = new Set<string>();

  if (gtsFiles.length > 0) {
    let gtsContents: { path: string; content: string }[] = [];
    for (let file of gtsFiles) {
      let readResult = await readSource(file);
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
    let readResult = await readSource(jsonUrl);
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
  // The realm's source POST returns once writes are durable, but the
  // search index settles asynchronously. Right after a `boxel realm
  // push`, a search for Spec cards may still see the pre-push state
  // and return zero results, which would make us silently skip the
  // freshly-pushed linkedExamples. Bounded-poll for up to ~30s while
  // the result is OK but empty so the index has a chance to catch up.
  let searchResult = await retryWithPoll(
    () =>
      search(realmUrl, { filter: { type: SPEC_TYPE } }, { profileManager: pm }),
    (r) => r.ok && (r.data?.length ?? 0) === 0,
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
      let pathError = validateRealmRelativePath(file.path);
      if (pathError) {
        throw new Error(pathError);
      }
      let normalized = join(tempDir, file.path);
      let resolved = resolve(normalized);
      if (!resolved.startsWith(tempDir + '/')) {
        throw new Error(
          `Path "${file.path}" resolves outside the parse workspace and was rejected.`,
        );
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
          // `@cardstack/local-types` is workspace-only — fed via `include`
          // below instead of `types` so the published CLI doesn't need a
          // resolvable `@cardstack/local-types` package in node_modules.
          types: ['qunit-dom'],
          paths: {
            'https://cardstack.com/base/*': [`${BASE_PKG_PATH}/*`],
            '@cardstack/host/tests/*': [`${HOST_TESTS_PATH}/*`],
            '@cardstack/host/*': [`${HOST_APP_PATH}/*`],
            '@cardstack/boxel-host/commands/*': [`${HOST_APP_PATH}/commands/*`],
            '@cardstack/boxel-ui/*': [`${BOXEL_UI_PATH}/*`],
            '*': [`${HOST_TYPES_PATH}/*`],
          },
        },
        include: [
          '**/*.ts',
          '**/*.gts',
          '**/*.gjs',
          `${LOCAL_TYPES_PATH}/**/*.d.ts`,
          ...(SHIMS_PATH ? [`${SHIMS_PATH}/**/*.d.ts`] : []),
        ],
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

    // Resolve the package's JS bin entry directly and run it with
    // `node`. Avoids the `.bin/ember-tsc` shim, which is a shell script
    // on POSIX and `ember-tsc.cmd` on Windows — invoking it cross-
    // platform via execFile is fiddly. The package's `bin/ember-tsc.js`
    // is the same JS the shim ultimately exec()s into, and using it
    // directly works everywhere Node runs.
    //
    // `@glint/ember-tsc`'s package.json has a catch-all `exports`
    // entry (`./*` → `./lib/*.js`) that swallows both `package.json`
    // and `bin/ember-tsc.js` lookups (turning the latter into the
    // nonexistent `bin/ember-tsc.js.js`). Resolve the package's main
    // entry — which IS in the exports map — and walk back to the
    // package root to find the bin file deterministically.
    let mainEntry = require.resolve('@glint/ember-tsc', {
      paths: [BOXEL_CLI_PATH],
    });
    // mainEntry is `<pkg>/lib/index.js`; pkg root is two levels up.
    let pkgRoot = resolve(dirname(mainEntry), '..');
    let emberTscEntry = join(pkgRoot, 'bin', 'ember-tsc.js');

    let { output, exitedWithError } = await new Promise<{
      output: string;
      exitedWithError: boolean;
    }>((resolvePromise, reject) => {
      let child = execFile(
        process.execPath,
        [
          emberTscEntry,
          '--noEmit',
          '--project',
          join(tempDir, 'tsconfig.json'),
        ],
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

// ---------------------------------------------------------------------------
// Workspace-mode helpers (read from local disk instead of the realm)
// ---------------------------------------------------------------------------

function discoverWorkspaceGtsFiles(workspaceDir: string): string[] {
  let results: string[] = [];
  walkWorkspaceFiles(workspaceDir, (rel) => {
    if (PARSEABLE_GTS_EXTENSIONS.some((ext) => rel.endsWith(ext))) {
      results.push(rel);
    }
  });
  return results.sort();
}

function discoverWorkspaceJsonInstanceFiles(workspaceDir: string): string[] {
  // In workspace mode we don't have realm search to find Spec
  // linkedExamples. We approximate by validating every `.json` file
  // that lives next to a card definition (i.e. in any subdir other
  // than `Validations/`, which holds artifact cards that aren't card
  // instances). The agent's normal layout puts instances under
  // `<CardType>/<slug>.json` and Specs under `Spec/<slug>.json`, both
  // of which we want to JSON-validate. Anything wrong here surfaces
  // as a card-document structural error, never a type error.
  let results: string[] = [];
  walkWorkspaceFiles(workspaceDir, (rel) => {
    if (!rel.endsWith(PARSEABLE_JSON_EXTENSION)) return;
    // Skip non-card JSON: tooling/metadata files, the realm-sync
    // sidecar `.boxel-sync.json` written by `boxel realm pull/push`,
    // and `Validations/*` artifact cards (we wrote those ourselves
    // and don't want to re-validate them against the current spec —
    // they reference now-obsolete schemas).
    let basename = rel.split('/').pop()!;
    if (
      basename === 'tsconfig.json' ||
      basename === 'package.json' ||
      basename === 'realm.json' ||
      basename === 'index.json' ||
      basename === '.boxel-sync.json'
    ) {
      return;
    }
    if (rel.startsWith('Validations/')) return;
    results.push(rel);
  });
  return results.sort();
}

function walkWorkspaceFiles(root: string, visit: (rel: string) => void): void {
  // Resolve to an absolute root so `relative()` produces correct
  // workspace-relative paths regardless of whether the caller passed
  // `.`, a relative path, or an absolute one. Manual string slicing
  // is hostile to `.` (because `join('.', 'X')` returns `'X'`, not
  // `'./X'`, so `slice('.'.length + 1)` eats the first 2 chars of
  // 'X' — observed bug in development).
  let absRoot = resolve(root);
  let walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (let entry of entries) {
      let full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else if (entry.isFile()) {
        // Normalize to POSIX `/` separators. Realm-relative paths
        // throughout the codebase use `/`, and `validateRealmRelativePath`
        // (called downstream by `runGlintCheck`) rejects backslashes.
        // On Windows, `relative()` returns native `\`-separated paths
        // — convert before forwarding.
        let rel = relative(absRoot, full).split(sep).join('/');
        visit(rel);
      }
    }
  };
  walk(absRoot);
}

function readWorkspaceSource(
  workspaceDir: string,
  path: string,
): { ok: true; content: string } | { ok: false; error: string } {
  let abs = join(workspaceDir, path);
  let normalized = resolve(abs);
  if (!normalized.startsWith(resolve(workspaceDir) + '/')) {
    return { ok: false, error: 'path resolves outside workspace' };
  }
  try {
    return { ok: true, content: readFileSync(normalized, 'utf8') };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

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
  realm?: string;
  workspace?: string;
  json?: boolean;
}

export function registerParseCommand(program: Command): void {
  program
    .command('parse')
    .description(
      "Type-check .gts / .gjs / .ts files with glint, plus validate the document structure of any .json card instances. Defaults to reading from the current working directory — the factory's pre-push validator (write files locally, parse, fix, then push). Pass --realm <url> to fetch source from a realm over HTTP instead, or --workspace <dir> to point at a non-cwd directory.",
    )
    .argument(
      '[path]',
      'Optional workspace-relative (default) or realm-relative (with --realm) file path. When omitted, parses every parseable file in the workspace / realm.',
    )
    .option(
      '--realm <realm-url>',
      'Fetch source from this realm over HTTP instead of reading from the workspace.',
    )
    .option(
      '--workspace <dir>',
      'Read source from this directory (default: cwd). Ignored when --realm is set.',
    )
    .option('--json', 'Output structured JSON result')
    .action(async (path: string | undefined, opts: ParseCliOptions) => {
      let result: ParseRealmResult;
      try {
        result = await parseRealm(opts.realm, {
          ...(path ? { path } : {}),
          ...(opts.workspace ? { workspace: opts.workspace } : {}),
        });
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
