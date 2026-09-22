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
 * sources, so a single module that 404s within it is a hard type error. That is
 * the right answer for a genuinely missing module and the accepted answer for a
 * mid-walk transient blip too: within an aliased prefix the two are not
 * distinguished.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { cacheDirForPrefix, fetchRealmSources } from './realm-source-cache.ts';

/**
 * Where fetched realm module sources land inside a parse run's temp dir. A
 * `paths` alias points each realm prefix at a subdirectory of this, and each
 * caller's tsconfig `exclude`s it so the staged sources are not themselves
 * type-checked as workspace files.
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
  /**
   * Reports a degradation worth surfacing (no origin, the fetch threw, an
   * unsafe module path, individual fetch failures). Left to the caller so each
   * keeps its own channel (`cliLog.warn`, the factory logger); omit to stay
   * silent.
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

async function resolveRealmSources(
  options: StageRealmSourcesOptions,
): Promise<StageRealmSourcesResult> {
  let { tempDir, files, prefixes, origin, fetchFn, onWarn } = options;
  let warn = (message: string) => onWarn?.(message);

  let referenced = prefixes.filter((prefix) =>
    files.some((file) => file.content.includes(prefix)),
  );
  if (referenced.length === 0) {
    return { realmPaths: {}, shimmedPrefixes: [] };
  }
  if (!origin) {
    warn(
      `Realm-prefixed imports (${referenced.join(', ')}) but no realm to resolve them against — falling back to the ambient shim.`,
    );
    return { realmPaths: {}, shimmedPrefixes: referenced };
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
    });
  } catch (error: unknown) {
    warn(
      `Could not fetch realm sources (${error instanceof Error ? error.message : String(error)}) — falling back to the ambient shim.`,
    );
    return { realmPaths: {}, shimmedPrefixes: referenced };
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

  if (result.failures.length > 0) {
    warn(
      `Could not fetch ${result.failures.length} realm module(s): ${result.failures
        .map((f) => `${f.specifier} (${f.reason})`)
        .join(', ')}`,
    );
  }

  let realmPaths: Record<string, string[]> = {};
  for (let prefix of result.resolvedPrefixes) {
    realmPaths[`${prefix}*`] = [
      `${join(cacheRoot, cacheDirForPrefix(prefix))}/*`,
    ];
  }

  return {
    realmPaths,
    shimmedPrefixes: referenced.filter(
      (prefix) => !result.resolvedPrefixes.includes(prefix),
    ),
  };
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
