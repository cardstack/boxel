import { logger, trimExecutableExtension } from './index';

export type ModuleLike = Record<string, any>;
export type ModuleDescriptor =
  | { prefix: `${string}/`; resolve: (rest: string) => Promise<ModuleLike> }
  | { id: string; resolve: () => Promise<ModuleLike> };

function trimModuleIdentifier(moduleIdentifier: string): string {
  return trimExecutableExtension(new URL(moduleIdentifier)).href;
}

export const PACKAGES_FAKE_ORIGIN = 'https://packages/';

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
  /Failed to fetch dynamically imported module/i,
  /Failed to fetch/i,
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
  // burning real wallclock time. Production passes `setTimeout`.
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
  log: ReturnType<typeof logger>,
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
          (response as any)[Symbol.for('shimmed-module')] = shimmedModule;
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
    this.moduleIds.set(
      trimModuleIdentifier(moduleIdentifier),
      async () => module,
    );
  }

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
    let resolver = this.moduleIds.get(trimModuleIdentifier(url));
    if (resolver) {
      return await resolver();
    }
    return undefined;
  }

  private async getModuleByPrefix(
    url: string,
  ): Promise<ModuleLike | undefined> {
    for (const [modulePrefix, resolveModule] of this.modulePrefixes) {
      if (url.startsWith(modulePrefix)) {
        let rest = url.slice(modulePrefix.length);
        return await resolveModule(rest);
        break;
      }
    }
    return undefined;
  }
}
