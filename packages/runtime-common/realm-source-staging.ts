/**
 * Stage realm-prefixed module sources into a parse run's temp dir.
 *
 * The node-only companion to `realm-source-cache.ts`. That module fetches realm
 * sources into memory with no `node:` import and no reach into
 * `@cardstack/base/*`, so a dependency-light consumer can import it; this one
 * writes those sources to disk and derives the tsconfig `paths` aliases — the
 * part that needs a filesystem. Both `boxel parse` and the software-factory
 * parse gate did this identically and had already started to drift (option
 * named `realmOrigin` vs `targetRealm`, a silent skip vs a logged warn), so it
 * lives here once. Only the prefix *list* stays per-caller: boxel-cli spells it
 * out as literals to keep its `lint:types` dependency-light, the factory derives
 * it from `PREFIX_REALMS` — so it is a parameter.
 *
 * Degrade, don't fail. A prefix whose sources could not be fetched is written
 * as an ambient `declare module` shim rather than left to surface as a hard
 * `Cannot find module`: `boxel parse` is a loop an author runs by hand, and a
 * gate that goes red because a realm was briefly unreachable reports a problem
 * in code that is correct. The shim types every import from the prefix as `any`,
 * which carries field, component and command reuse but not card-level adoption —
 * a subclass that declares a template still needs the real static side.
 *
 * That degrade-to-shim contract holds only when *every* fetch for a prefix
 * fails. A prefix with at least one module fetched is aliased at its real
 * sources. Within such a prefix, a missing module the *entry file* imports
 * directly is a hard type error anchored in the author's own file; a
 * *transitive* miss — a fetched module whose own import cannot be fetched —
 * anchors in the staged source, whose diagnostics the callers deliberately do
 * not report. Transitive misses therefore surface through the result's
 * `warnings`, worded here so both gates carry the same sentence.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import {
  cacheDirForPrefix,
  fetchRealmSources,
  type RealmSourceFailure,
} from './realm-source-cache.ts';

/**
 * Where fetched realm module sources land inside a parse run's temp dir. A
 * `paths` alias points each realm prefix at a subdirectory of this. Each
 * caller's tsconfig `exclude`s it, but `exclude` only keeps the staged sources
 * from becoming *root* files — a file imported by a checked file still enters
 * the program and is still checked. The callers' diagnostic loops partition on
 * this directory name to keep staged-source diagnostics out of the author's
 * errors without disarming their setup-failure detection.
 */
export const REALM_CACHE_DIR = '.realm-sources';

export interface StageRealmSourcesOptions {
  /** The parse run's temp dir. Sources land under `<tempDir>/<REALM_CACHE_DIR>/`. */
  tempDir: string;
  /** The files being type-checked, whose imports seed the fetch walk. */
  files: { path: string; content: string }[];
  /**
   * The realm prefixes this caller can resolve (with trailing slash), minus the
   * base realm, which is already aliased to real sources locally. boxel-cli
   * passes literals; the factory derives them from `PREFIX_REALMS`.
   */
  prefixes: string[];
  /**
   * Origin the prefix realms are served from — the realm being parsed, or the
   * active profile's realm server for a workspace parse. Absent means every
   * referenced prefix is shimmed.
   */
  origin: string | undefined;
  fetchFn?: typeof globalThis.fetch;
  /** See `FetchRealmSourcesOptions.cacheScope` — the identity behind `fetchFn`. */
  cacheScope?: string;
  /**
   * Reports a degradation worth surfacing (no origin, the fetch threw, an
   * unsafe module path). Left to the caller so each keeps its own channel
   * (`cliLog.warn`, the factory logger); omit to stay silent. Individual fetch
   * failures are not warned here — they come back in `failures` for the caller
   * to fold into its own result.
   */
  onWarn?: (message: string) => void;
}

export interface StageRealmSourcesResult {
  /** tsconfig `paths` entries aliasing each resolved prefix at its staged dir. */
  realmPaths: Record<string, string[]>;
  /**
   * Referenced prefixes that could not be resolved and were written to the
   * ambient shim instead. Returned for tests and diagnostics; the shim file is
   * already written by the time this returns.
   */
  shimmedPrefixes: string[];
  /**
   * Modules the walk could not fetch within prefixes that *were* aliased —
   * exactly the misses whose diagnostics anchor in staged sources and are
   * dropped by the callers' loops. Returned for tests and diagnostics; the
   * author-facing sentences are already in `warnings`.
   */
  failures: RealmSourceFailure[];
  /**
   * The degradations above as the sentences a gate's result carries — one per
   * unfetchable module, one naming the shimmed prefixes. Worded here, once,
   * so the two gates cannot describe the same degradation differently.
   */
  warnings: string[];
}

/**
 * Fetch the realm modules `files` import, write them into the run's temp dir,
 * write an ambient shim for any prefix that could not be resolved, and return
 * the tsconfig `paths` entries aliasing each resolved prefix at its sources.
 */
export async function stageRealmSources(
  options: StageRealmSourcesOptions,
): Promise<StageRealmSourcesResult> {
  let result = await resolveRealmSources(options);
  writeRealmShims(options.tempDir, result.shimmedPrefixes);
  return result;
}

function describeDegradations(
  failures: RealmSourceFailure[],
  shimmedPrefixes: string[],
): string[] {
  let warnings: string[] = [];
  for (let failure of failures) {
    warnings.push(
      `Could not fetch realm module ${failure.specifier} (${failure.reason}) — this check ran against an incomplete copy of that realm's code.`,
    );
  }
  if (shimmedPrefixes.length > 0) {
    warnings.push(
      `Realm prefix(es) ${shimmedPrefixes.join(', ')} could not be resolved; their imports were typed as 'any', so card-level adoption from them was not actually type-checked.`,
    );
  }
  return warnings;
}

async function resolveRealmSources(
  options: StageRealmSourcesOptions,
): Promise<StageRealmSourcesResult> {
  let { tempDir, files, prefixes, origin, fetchFn, cacheScope, onWarn } =
    options;
  let warn = (message: string) => onWarn?.(message);

  let referenced = prefixes.filter((prefix) =>
    files.some((file) => file.content.includes(prefix)),
  );
  if (referenced.length === 0) {
    return { realmPaths: {}, shimmedPrefixes: [], failures: [], warnings: [] };
  }
  if (!origin) {
    warn(
      `Realm-prefixed imports (${referenced.join(', ')}) but no realm to resolve them against — falling back to the ambient shim.`,
    );
    return {
      realmPaths: {},
      shimmedPrefixes: referenced,
      failures: [],
      warnings: describeDegradations([], referenced),
    };
  }

  // Hand the full prefix set to the fetch, not just the prefixes the entry
  // files name: a fetched module may import a *different* resolvable prefix
  // transitively, and fetching is demand-driven, so an unused entry in the map
  // costs nothing while a missing one would leave that transitive import
  // unresolved. Every prefix realm is served on the origin under its own name —
  // the same assumption `deriveCatalogRealmUrl` makes.
  let prefixRealmURLs = Object.fromEntries(
    prefixes.map((prefix) => [
      prefix,
      new URL(`/${cacheDirForPrefix(prefix)}/`, origin).href,
    ]),
  );

  let result: Awaited<ReturnType<typeof fetchRealmSources>>;
  try {
    result = await fetchRealmSources({
      entries: files,
      prefixRealmURLs,
      fetch: fetchFn,
      cacheScope,
    });
  } catch (error: unknown) {
    warn(
      `Could not fetch realm sources (${error instanceof Error ? error.message : String(error)}) — falling back to the ambient shim.`,
    );
    return {
      realmPaths: {},
      shimmedPrefixes: referenced,
      failures: [],
      warnings: describeDegradations([], referenced),
    };
  }

  let cacheRoot = join(tempDir, REALM_CACHE_DIR);
  for (let [cachePath, source] of result.modules) {
    let absolutePath = resolve(cacheRoot, cachePath);
    // `+ sep` rather than `+ '/'`: on Windows the separator is a backslash, and
    // a `'/'` check matches no staged path there — leaving the alias dir empty
    // and turning every realm import into a hard TS2307.
    if (!absolutePath.startsWith(cacheRoot + sep)) {
      warn(`Skipping realm module with unsafe path: ${cachePath}`);
      continue;
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source, 'utf8');
  }

  let realmPaths: Record<string, string[]> = {};
  for (let prefix of result.resolvedPrefixes) {
    realmPaths[`${prefix}*`] = [
      `${join(cacheRoot, cacheDirForPrefix(prefix))}/*`,
    ];
  }

  let shimmedPrefixes = referenced.filter(
    (prefix) => !result.resolvedPrefixes.includes(prefix),
  );
  return {
    realmPaths,
    shimmedPrefixes,
    failures: result.failures,
    warnings: describeDegradations(result.failures, shimmedPrefixes),
  };
}

/**
 * Classifies and accumulates type-checker diagnostics anchored in staged realm
 * sources — the decision both parse gates share, held in one place beside the
 * files it classifies so the gates cannot drift apart on what reads as a pass.
 *
 * `exclude` only keeps staged sources from being *root* files; a file imported
 * by a checked file still enters the program and still produces diagnostics.
 * Those are third-party code checked under a tsconfig not written for them, so
 * they are not the author's errors and are dropped — but counted here, apart
 * from the input-file counter, because folding them together would disarm
 * {@link isSilentSetupFailure} and let a non-zero type-checker exit read as a
 * clean pass.
 */
export interface StagedDiagnosticSink {
  /**
   * True — recorded, and the caller should skip the diagnostic — when
   * `absolutePath` sits under the staged-sources dir. The first few are kept
   * as samples for {@link StagedDiagnosticSink.warning}.
   */
  trackIfStaged(
    absolutePath: string,
    diagnostic: {
      line: string;
      column: string;
      tsCode: string;
      message: string;
    },
  ): boolean;
  count(): number;
  /** The sentence a gate's result carries for the dropped diagnostics, if any. */
  warning(): string | undefined;
}

const STAGED_DIAGNOSTIC_SAMPLE_CAP = 3;

export function createStagedDiagnosticSink(
  tempDir: string,
): StagedDiagnosticSink {
  let stagedCacheRoot = join(tempDir, REALM_CACHE_DIR);
  let count = 0;
  let samples: string[] = [];

  return {
    trackIfStaged(absolutePath, { line, column, tsCode, message }) {
      if (!absolutePath.startsWith(stagedCacheRoot + sep)) {
        return false;
      }
      count++;
      if (samples.length < STAGED_DIAGNOSTIC_SAMPLE_CAP) {
        samples.push(
          `${absolutePath.slice(tempDir.length + 1)}(${line},${column}): ${tsCode}: ${message}`,
        );
      }
      return true;
    },
    count: () => count,
    warning() {
      if (count === 0) {
        return undefined;
      }
      return `ember-tsc reported ${count} diagnostic(s) in fetched realm sources rather than in the checked files (e.g. ${samples[0]}). These are dropped — staged realm code is not what this run checks. If they name missing modules, the fetch-failure warnings above carry the cause.`;
    },
  };
}

/**
 * Whether a type-checker run that exited non-zero produced nothing to explain
 * it — the signature of a broken parse setup (bad tsconfig paths, missing
 * node_modules link), not of broken card code. Staged-source diagnostics count
 * as an explanation: they are dropped from the errors deliberately, which must
 * not make the run read as this failure — nor as a clean pass, which is why
 * they are counted apart from the input files' diagnostics at all.
 */
export function isSilentSetupFailure(run: {
  exitedWithError: boolean;
  errorCount: number;
  inputDiagnosticLines: number;
  stagedDiagnosticLines: number;
}): boolean {
  return (
    run.exitedWithError &&
    run.errorCount === 0 &&
    run.inputDiagnosticLines === 0 &&
    run.stagedDiagnosticLines === 0
  );
}

function writeRealmShims(tempDir: string, shimmedPrefixes: string[]): void {
  if (shimmedPrefixes.length === 0) {
    return;
  }
  // Bodiless is the only declaration form that works: a `const v: any` body
  // leaves named imports unresolved, and `export =` is rejected under
  // `module: es2022`.
  writeFileSync(
    join(tempDir, 'realm-shims.d.ts'),
    shimmedPrefixes.map((prefix) => `declare module '${prefix}*';`).join('\n') +
      '\n',
    'utf8',
  );
}
