import { rri } from './card-reference-resolver';
import { logger, trimExecutableExtension } from './index';

export type ModuleLike = Record<string, any>;
export type ModuleDescriptor =
  | { prefix: `${string}/`; resolve: (rest: string) => Promise<ModuleLike> }
  | { id: string; resolve: () => Promise<ModuleLike> };

function trimModuleIdentifier(moduleIdentifier: string): string {
  return trimExecutableExtension(rri(moduleIdentifier));
}

export const PACKAGES_FAKE_ORIGIN = 'https://packages/';

// Marker key the strict-namespace Proxy honors — modules tagged with
// this opt out of the missing-export check. Useful for modules whose
// exports are intentionally dynamic (e.g. test-only scaffolding) or
// for explicit interop with code that probes for optional keys.
//
// Specifically: when the namespace has the property
// `ALLOW_MISSING_NAMED_EXPORTS` set to the literal value `true`, the
// strict wrapper is skipped and the namespace is returned verbatim.
// Missing-key access then returns `undefined`, matching pre-Proxy
// behavior. The `=== true` check (rather than truthy/`Reflect.has`)
// avoids stray inherited properties or sentinel-shaped values from
// accidentally opting a module out.
export const ALLOW_MISSING_NAMED_EXPORTS = Symbol.for(
  'shim-handler.allowMissingNamedExports',
);

// Helper for shims that are intentional fallbacks — empty-or-stub
// namespaces that exist only to keep import resolution from
// crashing when the real module isn't present in the build (e.g.
// the live-test scaffolding shims in `host/app/lib/externals.ts`).
// Marks the returned object with `ALLOW_MISSING_NAMED_EXPORTS` so
// the strict-namespace Proxy won't throw on names that the
// fallback doesn't actually expose.
export function fallbackShim(extras?: ModuleLike): ModuleLike {
  let stub: ModuleLike = { ...(extras ?? {}) };
  (stub as any)[ALLOW_MISSING_NAMED_EXPORTS] = true;
  return stub;
}

// Names the JS runtime and common library code probe on arbitrary
// objects, NOT real named imports. Critical inclusions:
//
//   • `then` — `await ns` and `Promise.resolve(ns).then(...)` both
//     call `Reflect.get(value, 'then')` to detect thenables. If the
//     strict Proxy throws on this lookup, every awaited shimmed
//     module breaks (we observed exactly this in CI: cascading
//     `ReferenceError: Module '...' has no exported member 'then'`
//     across host / matrix / realm-server suites).
//   • `__esModule` — bundler CJS/ESM interop probes this to decide
//     how to bridge default exports.
//   • `toJSON` — `JSON.stringify(ns)` probes for it.
//   • Object.prototype method names (`toString`, `valueOf`, etc.) —
//     runtime + library code commonly probes these. They aren't
//     real exports either.
//
// All of these pass through unchanged; missing ones return whatever
// the underlying namespace would have returned (typically `undefined`
// for `then`/`__esModule`, the inherited Object.prototype method for
// the others).
const RUNTIME_PROBE_NAMES = new Set<string>([
  'then',
  '__esModule',
  'toJSON',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'constructor',
]);

// Wraps a shimmed module with a Proxy that throws a clear,
// actionable error when an importer reads a name that doesn't
// exist on the namespace. Plain JavaScript silently produces
// `undefined` for missing named imports, which then surfaces as a
// confusing "Cannot convert undefined or null to object" deep in
// Glimmer's helper-encoder (or wherever the importer eventually
// uses the binding) — the deterministic whitepaper render bug is
// exactly this footgun.
//
// Scope: every property *get* with a string key that isn't on the
// namespace AND isn't a runtime-probe name throws. Symbol gets,
// `has`, `ownKeys`, and `getOwnPropertyDescriptor` traps pass
// through unchanged so runtime introspection (`'foo' in ns`,
// `Object.keys(ns)`, `Reflect.has(...)`) keeps working.
//
// Escape hatch: if the namespace exposes
// `ALLOW_MISSING_NAMED_EXPORTS`, the Proxy returns `undefined` for
// missing string keys (pre-Proxy behavior). Modules that
// intentionally expose a dynamic shape can opt out this way.
//
// `findExportSources` is an optional hook supplied by the caller
// (`PackageShimHandler`). Given a missing export name, it returns the
// human-friendly module IDs of every currently-known shimmed module
// that owns an own-property with that name, so the throw path can name
// the correct subpath. It stays optional so tests that construct the
// wrapper directly (without a handler/virtual-network) keep working.
export type FindExportSources = (symbol: string) => string[];

export function wrapWithStrictNamespace(
  moduleIdentifier: string,
  namespace: ModuleLike,
  findExportSources?: FindExportSources,
): ModuleLike {
  if (
    namespace == null ||
    typeof namespace !== 'object' ||
    (namespace as any)[ALLOW_MISSING_NAMED_EXPORTS] === true
  ) {
    return namespace;
  }
  return new Proxy(namespace, {
    get(target, prop, receiver) {
      // Symbol properties (Symbol.toPrimitive, Symbol.iterator,
      // etc.) pass through — they're never the "I imported a name
      // that doesn't exist" pattern.
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      // Own-property check, NOT `prop in target`. An "exported
      // member" of a namespace is an own property; inherited names
      // like `toString`, `hasOwnProperty`, `constructor` from
      // `Object.prototype` aren't exports. Treating them as exports
      // (via `prop in target`) would silently let a card read those
      // values and bypass the missing-import check.
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      // Runtime probe — let it through to whatever the underlying
      // object would return. NOT a missing-import case.
      if (RUNTIME_PROBE_NAMES.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      let sources = findExportSources?.(prop) ?? [];
      throw new ReferenceError(
        buildMissingExportMessage(moduleIdentifier, prop, sources),
      );
    },
  });
}

// JS-undefined explanation appended to every missing-export error,
// whether or not we found a better source to point at.
const MISSING_EXPORT_TAIL =
  `(JavaScript silently produces \`undefined\` for missing named imports, ` +
  `which then surfaces as confusing downstream errors. This Proxy ` +
  `surfaces the missing import directly.)`;

function buildMissingExportMessage(
  moduleIdentifier: string,
  prop: string,
  sources: string[],
): string {
  let head = `Module '${moduleIdentifier}' has no exported member '${prop}'. `;
  if (sources.length === 0) {
    // No shimmed module owns this name (typo, genuinely-missing
    // export, …) — keep the original generic guidance verbatim.
    return (
      head +
      `If this is a card, check the import statement that names '${prop}' — ` +
      `you may be importing from the wrong module ID. ` +
      MISSING_EXPORT_TAIL
    );
  }
  // One or more shimmed modules export this name — point the author at
  // the correct subpath(s) and give a copy-pasteable corrected import
  // using the first match.
  return (
    head +
    `It is exported from ${formatModuleList(sources)} — try ` +
    `\`import { ${prop} } from '${sources[0]}'\`. ` +
    MISSING_EXPORT_TAIL
  );
}

// Renders module IDs as a backtick-quoted, comma-separated list with
// an Oxford "and" before the last entry: `a`; `a` and `b`; `a`, `b`,
// and `c`.
function formatModuleList(modules: string[]): string {
  let quoted = modules.map((m) => `\`${m}\``);
  if (quoted.length === 1) {
    return quoted[0];
  }
  if (quoted.length === 2) {
    return `${quoted[0]} and ${quoted[1]}`;
  }
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
}

// Backoff schedule applied between retries for a failed
// `shimAsyncModule` resolver. Aligned with `loader.ts`'s
// `DEFAULT_TRANSIENT_RETRY_DELAYS_MS = [100, 300, 900]` so the two
// retry layers use the same shape — operators investigating a flaky
// fetch see consistent backoff across realm-source fetches and
// shim-resolver chunk fetches. Worst-case added latency on a
// persistent failure: ~1.3s, well under cardRenderTimeout (90s).
//
// Each entry is a wallclock delay in ms BEFORE the corresponding
// retry attempt. The first attempt has no preceding delay, so the
// schedule starts at `RETRY_DELAYS_MS[0]` for the second attempt.
// Total maximum elapsed wait = sum of entries.
const RETRY_DELAYS_MS: readonly number[] = [100, 300, 900];

// Patterns we consider transient for dynamic-import / chunk-fetch
// failures. Match against `err.name` AND `err.message` because
// browsers / loaders disagree on which carries the discriminator
// (Webpack uses `err.name === 'ChunkLoadError'`; native Node
// `import()` uses message-based identifiers; some bundlers wrap
// network errors with their own classes that only surface in the
// message).
//
// HTTP statuses: only 502/503/504 match. `loader.ts` explicitly
// excludes 500 because the loader's own `_fetch` converts network
// failures into synthetic 500 Response objects, and we don't want
// to double-retry those. The same policy applies here so the two
// retry layers can't disagree on what counts as transient.
//
// NOTE: anything NOT matched here is surfaced on the first attempt
// without retry. This is deliberate — retrying a `SyntaxError` from
// a malformed module just wastes the budget and delays the actual
// error reaching the operator.
const RETRYABLE_ERROR_NAMES = new Set([
  'ChunkLoadError',
  'NetworkError',
  'TimeoutError',
  'AbortError',
]);
// Node `err.code` values for transient socket / DNS failures. Distinct
// from `RETRYABLE_ERROR_NAMES` because Node attaches these on
// `err.code` (kept in this set) while browsers expose the same class
// of failure via `err.name` (kept in the names set above).
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
]);
const RETRYABLE_MESSAGE_PATTERNS: readonly RegExp[] = [
  /Loading (?:CSS )?chunk \S+ failed/i,
  // Specifically the dynamic-import failure message — a bare
  // `/Failed to fetch/i` was tempting here but matches too much: any
  // resolver that throws "Failed to fetch <whatever>" for a non-
  // chunk reason (deliberate `fetch()` calls inside the resolver,
  // for instance) would get retried as if it were a chunk-load
  // transient. The dynamic-import variant is what `import()`
  // actually throws on a chunk-fetch failure, and that's the case
  // we want to retry.
  /Failed to fetch dynamically imported module/i,
  /NetworkError when attempting to fetch resource/i,
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/,
  /ERR_(?:CONNECTION_RESET|CONNECTION_REFUSED|NETWORK_CHANGED|INTERNET_DISCONNECTED|EMPTY_RESPONSE|TIMED_OUT)/,
  /status of 50[234]/i,
  /returned HTTP 50[234]/i,
];

export function isRetryableShimResolveError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error !== 'object') return false;
  let err = error as { name?: unknown; message?: unknown; code?: unknown };
  if (typeof err.name === 'string' && RETRYABLE_ERROR_NAMES.has(err.name)) {
    return true;
  }
  if (typeof err.code === 'string' && RETRYABLE_ERROR_CODES.has(err.code)) {
    return true;
  }
  if (typeof err.message === 'string') {
    for (let pattern of RETRYABLE_MESSAGE_PATTERNS) {
      if (pattern.test(err.message)) return true;
    }
  }
  return false;
}

export interface ShimRetryDeps {
  // Pluggable for tests so we can assert backoff behavior without
  // burning real wallclock time. When omitted, the retry path uses
  // `defaultDelay` (a thin `setTimeout`-based sleep) below.
  delay?: (ms: number) => Promise<void>;
  // Override the default backoff schedule. Tests can pass `[]` to
  // collapse retries into a single attempt.
  retryDelaysMs?: readonly number[];
  // Override the retryable-error classifier. Defaults to
  // `isRetryableShimResolveError`. Tests can force-retry every error
  // or force-skip every retry to exercise both branches.
  isRetryable?: (error: unknown) => boolean;
}

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Minimal logging surface used by `withResolveRetry`. Narrower than
// `ReturnType<typeof logger>` so tests can pass a no-op stub without
// having to construct a full `loglevel` instance — the production
// code only ever calls `warn` and `debug`.
export interface ShimRetryLogger {
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

// Wraps a shim resolver with retry-on-transient-failure + bounded
// exponential backoff. Returns a function with the same signature as
// the input, so `shimAsyncModule` can swap it in transparently.
//
// On non-retryable errors (SyntaxError, ReferenceError, etc. — see
// `isRetryableShimResolveError`), the function fails fast on the
// first attempt with the original error preserved verbatim. This
// keeps the operator-facing error message intact instead of
// burying it under "tried 3 times".
export function withResolveRetry<TArgs extends unknown[], TResult>(
  label: string,
  log: ShimRetryLogger,
  fn: (...args: TArgs) => Promise<TResult>,
  deps: ShimRetryDeps = {},
): (...args: TArgs) => Promise<TResult> {
  let delay = deps.delay ?? defaultDelay;
  let delaysMs = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  let isRetryable = deps.isRetryable ?? isRetryableShimResolveError;
  return async (...args: TArgs): Promise<TResult> => {
    let lastError: unknown;
    let totalAttempts = delaysMs.length + 1;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastError = err;
        if (attempt === totalAttempts - 1) break;
        if (!isRetryable(err)) {
          // Fail fast for non-transient errors — retrying a syntax
          // error or a missing module wastes the budget and delays
          // the error surfacing to the operator.
          log.debug(
            `shim resolver for ${label} failed with non-retryable error; not retrying`,
            err,
          );
          break;
        }
        let waitMs = delaysMs[attempt];
        log.warn(
          `shim resolver for ${label} failed on attempt ${attempt + 1}/${totalAttempts}; retrying in ${waitMs}ms`,
          err,
        );
        await delay(waitMs);
      }
    }
    throw lastError;
  };
}

export class PackageShimHandler {
  private resolveImport: (moduleIdentifier: string) => string;
  private moduleIds = new Map<string, () => Promise<ModuleLike>>();
  private modulePrefixes = new Map<
    string,
    (rest: string) => Promise<ModuleLike>
  >();
  // Resolved exports of every shimmed module we currently know about,
  // keyed by trimmed module identifier. Synchronously-shimmed modules
  // land here at registration; async-shimmed ones are cached the first
  // time they resolve through `handle`. Used by `findExportSources` to
  // suggest the correct subpath when an importer names an export that
  // lives on a *different* shim. Best-effort: an async shim that hasn't
  // been served yet won't be searchable until it has.
  private resolvedExports = new Map<string, ModuleLike>();
  private log = logger('shim-handler');

  constructor(resolveImport: (moduleIdentifier: string) => string) {
    this.resolveImport = resolveImport;
  }

  handle = async (request: Request): Promise<Response | null> => {
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      try {
        let shimmedModule =
          (await this.getModule(request.url)) ||
          (await this.getModuleByPrefix(request.url));
        if (shimmedModule) {
          let response = new Response();
          // Wrap with the strict-namespace Proxy so importers that
          // name a non-existent export get a clear ReferenceError at
          // the access site instead of silently consuming `undefined`
          // and surfacing a confusing downstream error. The wrapped
          // namespace preserves the underlying module's shape for all
          // existing keys; only missing-key string reads change
          // behavior.
          (response as any)[Symbol.for('shimmed-module')] =
            wrapWithStrictNamespace(
              request.url,
              shimmedModule,
              this.findExportSources,
            );
          return response;
        }
        return null;
      } catch (err: any) {
        this.log.error(
          `PackageShimHandler#handle threw an error handling ${request.url}`,
          err,
        );
        return null;
      }
    }
    return null;
  };

  shimModule(moduleIdentifier: string, module: ModuleLike) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    let key = trimModuleIdentifier(moduleIdentifier);
    this.moduleIds.set(key, async () => module);
    this.rememberExports(key, module);
  }

  // Records a resolved module's exports for `findExportSources`.
  // Non-object resolutions (rare, but resolvers can return anything)
  // are skipped — there are no own-properties to search.
  private rememberExports(key: string, module: ModuleLike) {
    if (module != null && typeof module === 'object') {
      this.resolvedExports.set(key, module);
    }
  }

  // Lookup hook handed to `wrapWithStrictNamespace`. Given a missing
  // export name, returns the import-friendly IDs of every known shim
  // that owns an own-property with that name. Uses `hasOwnProperty`
  // (not `in`) for the same reason the Proxy does: only own properties
  // are real exports — inherited Object.prototype names aren't.
  private findExportSources = (symbol: string): string[] => {
    let matches: string[] = [];
    for (let [moduleId, exports] of this.resolvedExports) {
      if (
        exports != null &&
        typeof exports === 'object' &&
        Object.prototype.hasOwnProperty.call(exports, symbol)
      ) {
        matches.push(toImportSpecifier(moduleId));
      }
    }
    return matches;
  };

  shimAsyncModule(descriptor: ModuleDescriptor, retryDeps?: ShimRetryDeps) {
    // Wrap each user-supplied resolver with bounded retry against the
    // transient-failure error class. The original resolver typically
    // calls `import('<some-package>')`, which compiles to a runtime
    // chunk fetch — and chunk fetches can blip on network errors,
    // mid-deploy chunk-hash swaps, or transient 5xx responses. Without
    // retry, a single dropped fetch translates into the consumer
    // seeing `undefined` exports, which is what the whitepaper render
    // bug looks like to Glimmer's helper-encoder.
    //
    // Non-transient errors (SyntaxError from a bad module, missing
    // module, etc.) fail fast on the first attempt — see
    // `isRetryableShimResolveError`.
    if ('prefix' in descriptor) {
      let label = `prefix:${descriptor.prefix}`;
      this.modulePrefixes.set(
        this.resolveImport(descriptor.prefix),
        withResolveRetry(label, this.log, descriptor.resolve, retryDeps),
      );
    } else {
      let moduleIdentifier = this.resolveImport(descriptor.id);
      let label = `id:${descriptor.id}`;
      this.moduleIds.set(
        trimModuleIdentifier(moduleIdentifier),
        withResolveRetry(label, this.log, descriptor.resolve, retryDeps),
      );
    }
  }

  private async getModule(url: string): Promise<ModuleLike | undefined> {
    let key = trimModuleIdentifier(url);
    let resolver = this.moduleIds.get(key);
    if (resolver) {
      let module = await resolver();
      // Cache so an async-shimmed module becomes searchable by
      // `findExportSources` once it has been served at least once.
      this.rememberExports(key, module);
      return module;
    }
    return undefined;
  }

  private async getModuleByPrefix(
    url: string,
  ): Promise<ModuleLike | undefined> {
    for (const [modulePrefix, resolveModule] of this.modulePrefixes) {
      if (url.startsWith(modulePrefix)) {
        let rest = url.slice(modulePrefix.length);
        let module = await resolveModule(rest);
        this.rememberExports(trimModuleIdentifier(url), module);
        return module;
      }
    }
    return undefined;
  }
}

// Turns the internal module key (a `https://packages/...` fake-origin
// URL for shimmed packages) back into the bare import specifier an
// author would actually write — `@cardstack/runtime-common/marked-sync`
// rather than `https://packages/@cardstack/runtime-common/marked-sync`.
// Real-URL modules (no fake origin) are returned as-is.
function toImportSpecifier(moduleId: string): string {
  return moduleId.startsWith(PACKAGES_FAKE_ORIGIN)
    ? moduleId.slice(PACKAGES_FAKE_ORIGIN.length)
    : moduleId;
}
