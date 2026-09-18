/**
 * Fetch the source of realm-prefixed modules so a type-checker can resolve
 * them.
 *
 * A card that imports `@cardstack/catalog/<path>` is importing a module that
 * exists only in a realm. `tsc` has no way to reach it, so a type-check of that
 * card fails on the import alone — the card is correct and the gate is wrong.
 * Fetching the module's source and pointing a `paths` alias at it makes the
 * import resolve to the real definition, which is what card-level adoption
 * needs: an `any`-typed ambient shim leaves a subclass's static side
 * unresolvable, so any subclass that also declares a template fails with
 * `typeof X does not satisfy the constraint 'typeof BaseDef'`.
 *
 * Deliberately free of `node:` imports and of any import that reaches
 * `@cardstack/base/*`, so both a Node consumer and a dependency-light one can
 * import it (see the note on RealmPathsVirtualNetwork in `paths.ts`). It
 * returns sources in memory and never touches a filesystem; the caller decides
 * where they land.
 *
 * The prefix-to-realm map is a parameter rather than a lookup so that a
 * consumer which must not import `PREFIX_REALMS` can pass its own literals.
 */

/** A module's source, keyed by its path relative to the cache root. */
export type RealmSourceModules = Map<string, string>;

export interface FetchRealmSourcesOptions {
  /** The files being type-checked, whose imports seed the walk. */
  entries: { path: string; content: string }[];
  /**
   * Registered prefix (with trailing slash) to the realm URL serving it, e.g.
   * `{'@cardstack/catalog/': 'https://example.com/catalog/'}`. A prefix absent
   * here is left alone: the caller either aliases it some other way or wants it
   * to stay unresolved.
   */
  prefixRealmURLs: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /**
   * How far to follow imports out of the entry files. A realm module graph is
   * shallow, but it is authored by someone else and a bound is cheap.
   */
  maxDepth?: number;
  /** Sent as `Authorization` when the realm is not public. */
  authorization?: string;
}

export interface RealmSourceFailure {
  specifier: string;
  reason: string;
}

export interface FetchRealmSourcesResult {
  /** Cache-relative path (`catalog/foo/bar.gts`) to source. */
  modules: RealmSourceModules;
  /** Prefixes at least one module was fetched for. */
  resolvedPrefixes: string[];
  /**
   * Specifiers that could not be fetched. Non-empty means the caller should
   * degrade rather than fail: a realm that is down must not turn every card
   * that references it red.
   */
  failures: RealmSourceFailure[];
}

const DEFAULT_MAX_DEPTH = 10;

/**
 * Extensions to try when a specifier carries none. Card code imports
 * `./author`, and the realm serves `./author.gts`.
 */
const MODULE_EXTENSIONS = ['.gts', '.ts', '.gjs', '.js'];

/**
 * A realm serves two different things at one module URL: a plain GET returns
 * the module *transpiled* — decorators lowered, templates compiled — which
 * resolves and type-checks as though it were the source while describing
 * different types. This header is what asks for the bytes on disk.
 */
const SOURCE_ACCEPT = 'application/vnd.card+source';

/**
 * Cross-call memo of fetched sources, keyed by absolute module URL. A run
 * type-checks many cards against the same handful of realm modules, and the
 * validators run repeatedly against a realm whose modules rarely change, so a
 * repeat fetch revalidates with the stored validator instead of re-downloading.
 */
const sourceCache = new Map<
  string,
  { source: string; etag?: string; lastModified?: string }
>();

/** Exported for tests; a process otherwise keeps the memo for its lifetime. */
export function clearRealmSourceCache(): void {
  sourceCache.clear();
}

/**
 * Collect the import specifiers of a module.
 *
 * A regex rather than a parse: the input includes `.gts`, whose templates no
 * TypeScript parser reads without a preprocessor, and the cost of a wrong
 * answer is bounded. A false positive fetches a module nothing imports and is
 * discarded; a false negative leaves one import unresolved, which is the
 * behavior that exists today.
 */
export function collectImportSpecifiers(source: string): string[] {
  let specifiers: string[] = [];
  // `import …  from '<spec>'`, `export … from '<spec>'`, bare `import '<spec>'`
  // and dynamic `import('<spec>')`.
  let staticImport =
    /(?:^|[\s;})])(?:import|export)\s*(?:[\w*{}\n\r\t,$ ]+\s*from\s*)?['"]([^'"]+)['"]/g;
  let dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (let pattern of [staticImport, dynamicImport]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

/**
 * Split a specifier into the prefix that owns it and the rest.
 *
 * The longest matching prefix wins, so a more specific registration is not
 * shadowed by a broader one sharing its opening segments.
 */
function matchPrefix(
  specifier: string,
  prefixRealmURLs: Record<string, string>,
): { prefix: string; realmURL: string; realmPath: string } | undefined {
  let best: { prefix: string; realmURL: string; realmPath: string } | undefined;

  for (let [prefix, realmURL] of Object.entries(prefixRealmURLs)) {
    if (!specifier.startsWith(prefix)) {
      continue;
    }
    if (best && best.prefix.length >= prefix.length) {
      continue;
    }
    best = {
      prefix,
      realmURL,
      realmPath: specifier.slice(prefix.length),
    };
  }

  return best;
}

/**
 * The cache directory a prefix's modules live under — its last non-empty
 * segment, so `@cardstack/catalog/` becomes `catalog/`. The caller builds the
 * matching `paths` alias from the same function, so the two cannot disagree.
 */
export function cacheDirForPrefix(prefix: string): string {
  let segments = prefix.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? prefix;
}

/** Resolve a relative specifier against a realm-relative module path. */
function resolveRelative(fromRealmPath: string, specifier: string): string {
  let base = fromRealmPath.split('/').slice(0, -1);
  let segments = specifier.split('/');

  for (let segment of segments) {
    if (segment === '.' || segment === '') {
      continue;
    }
    if (segment === '..') {
      base.pop();
      continue;
    }
    base.push(segment);
  }

  return base.join('/');
}

function hasKnownExtension(path: string): boolean {
  return MODULE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Fetch one module, trying each candidate extension.
 *
 * A stored entry is revalidated rather than refetched: the realm answers `304`
 * and the body never crosses the wire.
 */
async function fetchModuleSource(
  realmURL: string,
  realmPath: string,
  fetchFn: typeof globalThis.fetch,
  authorization: string | undefined,
): Promise<{ realmPath: string; source: string } | { error: string }> {
  let candidates = hasKnownExtension(realmPath)
    ? [realmPath]
    : MODULE_EXTENSIONS.map((ext) => `${realmPath}${ext}`);
  let errors: string[] = [];

  for (let candidate of candidates) {
    let url = new URL(candidate, realmURL).href;
    let cached = sourceCache.get(url);
    let headers: Record<string, string> = { Accept: SOURCE_ACCEPT };
    if (authorization) {
      headers.Authorization = authorization;
    }
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    } else if (cached?.lastModified) {
      headers['If-Modified-Since'] = cached.lastModified;
    }

    let response: Response;
    try {
      response = await fetchFn(url, { headers });
    } catch (error: unknown) {
      errors.push(
        `${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (response.status === 304 && cached) {
      return { realmPath: candidate, source: cached.source };
    }
    if (!response.ok) {
      errors.push(`${candidate}: ${response.status}`);
      continue;
    }

    let source = await response.text();
    sourceCache.set(url, {
      source,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
    });
    return { realmPath: candidate, source };
  }

  return { error: errors.join('; ') || 'not found' };
}

/**
 * Walk the realm-prefixed imports of `entries` and return every module's
 * source, keyed by the path it should be written to under a cache root.
 *
 * Never throws for a fetch that failed: an unreachable realm is reported in
 * `failures` so the caller can degrade to a shim, because a type gate that goes
 * red when a network call fails has replaced one problem with a worse one.
 */
export async function fetchRealmSources(
  options: FetchRealmSourcesOptions,
): Promise<FetchRealmSourcesResult> {
  let {
    entries,
    prefixRealmURLs,
    fetch: fetchFn = globalThis.fetch,
    maxDepth = DEFAULT_MAX_DEPTH,
    authorization,
  } = options;

  let modules: RealmSourceModules = new Map();
  let resolvedPrefixes = new Set<string>();
  let failures: RealmSourceFailure[] = [];
  let seen = new Set<string>();

  // (prefix, realm-relative path) pairs still to fetch, with the depth they
  // were discovered at. Breadth-first, so a bounded depth cuts the furthest
  // modules rather than an arbitrary branch.
  type Pending = { prefix: string; realmPath: string; depth: number };
  let queue: Pending[] = [];

  function enqueueSpecifier(
    specifier: string,
    depth: number,
    from?: { prefix: string; realmPath: string },
  ): void {
    let target: { prefix: string; realmPath: string } | undefined;

    if (specifier.startsWith('.')) {
      // Relative imports are only followed out of a module already fetched
      // from a realm; a relative import in an entry file is a workspace file
      // the caller already has.
      if (!from) {
        return;
      }
      target = {
        prefix: from.prefix,
        realmPath: resolveRelative(from.realmPath, specifier),
      };
    } else {
      let matched = matchPrefix(specifier, prefixRealmURLs);
      if (!matched) {
        return;
      }
      target = { prefix: matched.prefix, realmPath: matched.realmPath };
    }

    let key = `${target.prefix}${target.realmPath}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queue.push({ ...target, depth });
  }

  for (let entry of entries) {
    for (let specifier of collectImportSpecifiers(entry.content)) {
      enqueueSpecifier(specifier, 0);
    }
  }

  while (queue.length > 0) {
    let batch = queue;
    queue = [];

    let results = await Promise.all(
      batch.map(async (pending) => {
        let realmURL = prefixRealmURLs[pending.prefix];
        let fetched = await fetchModuleSource(
          realmURL,
          pending.realmPath,
          fetchFn,
          authorization,
        );
        return { pending, fetched };
      }),
    );

    for (let { pending, fetched } of results) {
      if ('error' in fetched) {
        failures.push({
          specifier: `${pending.prefix}${pending.realmPath}`,
          reason: fetched.error,
        });
        continue;
      }

      resolvedPrefixes.add(pending.prefix);
      modules.set(
        `${cacheDirForPrefix(pending.prefix)}/${fetched.realmPath}`,
        fetched.source,
      );

      if (pending.depth >= maxDepth) {
        continue;
      }
      for (let specifier of collectImportSpecifiers(fetched.source)) {
        enqueueSpecifier(specifier, pending.depth + 1, {
          prefix: pending.prefix,
          realmPath: fetched.realmPath,
        });
      }
    }
  }

  return {
    modules,
    resolvedPrefixes: [...resolvedPrefixes],
    failures,
  };
}
