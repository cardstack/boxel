import { RealmPaths, ensureTrailingSlash } from './paths';
import { baseRealm } from './index';
import {
  registerCardReferencePrefix,
  unregisterCardReferencePrefix,
  isRegisteredPrefix as globalIsRegisteredPrefix,
  resolveCardReference as globalResolveCardReference,
  unresolveCardReference as globalUnresolveCardReference,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from './card-reference-resolver';
import type { ModuleDescriptor } from './package-shim-handler';
import {
  PackageShimHandler,
  PACKAGES_FAKE_ORIGIN,
  type ModuleLike,
} from './package-shim-handler';
import type { Readable } from 'stream';
import { fetcher, type FetcherMiddlewareHandler } from './fetcher';
import { createEnvironmentAwareFetch } from '#fetch';

export interface ResponseWithNodeStream extends Response {
  nodeStream?: Readable;
}

export type Handler = (req: Request) => Promise<Response | null>;

export class VirtualNetwork {
  private handlers: Handler[] = [];
  private urlMappings: [string, string][] = [];
  private importMap: Map<string, (rest: string) => string> = new Map();
  private realmMappings = new Map<string, string>();

  constructor(nativeFetch = createEnvironmentAwareFetch()) {
    this.nativeFetch = nativeFetch;
    this.mount(this.packageShimHandler.handle);
  }

  resolveImport = (moduleIdentifier: string) => {
    for (let [prefix, handler] of this.importMap) {
      if (moduleIdentifier.startsWith(prefix)) {
        return handler(moduleIdentifier.slice(prefix.length));
      }
    }
    if (!isUrlLike(moduleIdentifier)) {
      moduleIdentifier = new URL(moduleIdentifier, PACKAGES_FAKE_ORIGIN).href;
    }
    return moduleIdentifier;
  };

  private packageShimHandler = new PackageShimHandler(this.resolveImport);

  shimModule(moduleIdentifier: string, module: ModuleLike) {
    this.packageShimHandler.shimModule(moduleIdentifier, module);
  }

  shimAsyncModule(descriptor: ModuleDescriptor) {
    this.packageShimHandler.shimAsyncModule(descriptor);
  }

  addURLMapping(from: URL, to: URL) {
    this.urlMappings.push([from.href, to.href]);
  }

  mapURL(
    url: string | URL,
    direction: 'virtual-to-real' | 'real-to-virtual',
  ): URL | undefined {
    let resolved = this.resolveURLMapping(
      typeof url === 'string' ? url : url.href,
      direction,
    );
    return resolved ? new URL(resolved) : undefined;
  }

  addImportMap(prefix: string, handler: (rest: string) => string): void {
    this.importMap.set(prefix, handler);
  }

  /**
   * Register a scoped realm prefix and its target URL. This populates the
   * import map (for module loading) and global prefix mappings (for card
   * reference resolution). It does NOT add a URL-to-URL mapping — use
   * `addURLMapping` separately when a virtual URL (e.g.
   * `https://cardstack.com/base/`) needs to map to a real URL.
   */
  addRealmMapping(realmIdentifier: string, targetURL: string): void {
    let normalizedId = ensureTrailingSlash(realmIdentifier);
    let normalizedTarget = ensureTrailingSlash(targetURL);
    this.realmMappings.set(normalizedId, normalizedTarget);

    // Backward compat bridge: populate both existing registration systems
    // so that resolveImport and resolveCardReference continue to work
    this.addImportMap(
      normalizedId,
      (rest) => new URL(rest, normalizedTarget).href,
    );
    registerCardReferencePrefix(normalizedId, normalizedTarget);
  }

  /**
   * Remove a previously-registered realm prefix mapping. Companion to
   * `addRealmMapping`. Used today by tests that scope a temporary prefix
   * to a single test and clean up afterwards so the VN doesn't carry
   * the mapping into sibling tests.
   */
  removeRealmMapping(realmIdentifier: string): void {
    let normalizedId = ensureTrailingSlash(realmIdentifier);
    this.realmMappings.delete(normalizedId);
    this.importMap.delete(normalizedId);
    unregisterCardReferencePrefix(normalizedId);
  }

  knownRealms(): RealmIdentifier[] {
    return [...this.realmMappings.keys()] as RealmIdentifier[];
  }

  /**
   * Whether `reference` starts with one of this VN's registered realm
   * prefixes (e.g. `@cardstack/base/foo` against a registered
   * `@cardstack/base/` mapping).
   *
   * Replacement for the deprecated module-level `isRegisteredPrefix()`
   * (which reads from the soon-to-be-removed global `prefixMappings`).
   */
  isRegisteredPrefix(reference: string): boolean {
    for (let [prefix] of this.realmMappings) {
      if (reference.startsWith(prefix)) {
        return true;
      }
    }
    // Also consult the deprecated module-level `prefixMappings` registry
    // so VN-aware callers see prefixes that legacy code (and tests)
    // register via `registerCardReferencePrefix`.
    return globalIsRegisteredPrefix(reference);
  }

  /**
   * Convert a resolved URL back to its registered prefix form when one
   * matches, e.g. `http://localhost:4201/catalog/foo` → `@cardstack/catalog/foo`.
   * URLs that don't match any registered prefix are returned as-is.
   *
   * Replacement for the deprecated `unresolveCardReference()`.
   */
  unresolveURL(url: string): RealmResourceIdentifier {
    for (let [prefix, target] of this.realmMappings) {
      if (url.startsWith(target)) {
        return (prefix + url.slice(target.length)) as RealmResourceIdentifier;
      }
    }
    // Defer to the deprecated module-level `unresolveCardReference` so
    // prefixes registered globally (e.g. by legacy tests via
    // `registerCardReferencePrefix`) still unresolve correctly.
    return globalUnresolveCardReference(url) as RealmResourceIdentifier;
  }

  /**
   * Resolve `reference` (relative path, prefix-form RRI, or URL string)
   * to a canonical URL object using `relativeTo` as the base when
   * `reference` is relative. Replacement for the deprecated module-level
   * `resolveCardReference()` for callers that need URL form.
   *
   * Composes `resolveRRI` + `toURL` and falls back to the deprecated
   * resolver if VN-aware resolution can't see the relevant prefix (e.g.
   * a global-only registration).
   */
  resolveURL(reference: string, relativeTo: URL | string | undefined): URL {
    let base: RealmResourceIdentifier | undefined;
    if (relativeTo instanceof URL) {
      base = relativeTo.href as RealmResourceIdentifier;
    } else if (typeof relativeTo === 'string') {
      base = relativeTo as RealmResourceIdentifier;
    }
    // When `relativeTo` is a prefix-form string whose prefix isn't in
    // this VN's map, `resolveRRI` would throw because its
    // relative-against-prefix-form branches iterate VN's own mappings.
    // Defer to the deprecated global resolver for that exact case so
    // globally-registered prefixes still resolve. Other `resolveRRI`
    // failures (e.g. its deliberate rejection of `/`-rooted and `~/`
    // refs) propagate.
    if (
      typeof base === 'string' &&
      !base.startsWith('http://') &&
      !base.startsWith('https://')
    ) {
      let baseInVN = false;
      for (let [prefix] of this.realmMappings) {
        if (base.startsWith(prefix)) {
          baseInVN = true;
          break;
        }
      }
      if (!baseInVN) {
        return new URL(globalResolveCardReference(reference, relativeTo));
      }
    }
    return this.toURL(this.resolveRRI(reference, base));
  }

  /**
   * Convert an RRI to a URL object. If the RRI is in prefix form, resolves
   * via the registered realm mappings; if it's already a URL form, parses
   * directly. Throws if the prefix is unregistered and the value isn't a
   * parseable URL — that's intentional: bare local identifiers can't be
   * resolved to a realm location.
   *
   * Replacement for the deprecated `cardIdToURL()`.
   */
  toURL(rri: string): URL {
    let resolved = this.resolveRRIToURL(rri);
    if (resolved !== undefined) {
      return new URL(resolved);
    }
    // Defer to the deprecated module-level `resolveCardReference` so
    // prefixes registered globally still resolve.
    try {
      return new URL(globalResolveCardReference(rri, undefined));
    } catch {
      // Not a registered prefix anywhere; fall through to plain URL
      // parsing (preserves the original throw for non-URL inputs).
    }
    return new URL(rri);
  }

  /**
   * Resolve a reference to an absolute `RealmResourceIdentifier`.
   *
   * Resolution rules:
   * - Absolute URL or registered prefix → return as-is
   * - Relative (`./`, `../`, bare name) → resolve against `relativeTo`
   * - `$REALM/` → resolve against the realm root of `relativeTo`
   * - `/` or `~/` prefixed → throw (not valid RRI forms)
   *
   * Replacement for the deprecated module-level `resolveRRI()`.
   */
  resolveRRI(
    reference: string,
    relativeTo?: RealmResourceIdentifier,
  ): RealmResourceIdentifier {
    // Absolute URL — already resolved
    if (reference.startsWith('http://') || reference.startsWith('https://')) {
      return reference as RealmResourceIdentifier;
    }

    // Starts with a registered prefix — already resolved
    if (this.isRegisteredPrefix(reference)) {
      return reference as RealmResourceIdentifier;
    }

    // "/" and "~/" are not valid RRI reference forms
    if (reference.startsWith('/') || reference.startsWith('~/')) {
      throw new Error(
        `Invalid RRI reference "${reference}" — "/" and "~/" prefixes are not supported`,
      );
    }

    if (!relativeTo) {
      throw new Error(`Cannot resolve "${reference}" without a relativeTo`);
    }

    let isUrlRelativeTo =
      relativeTo.startsWith('http://') || relativeTo.startsWith('https://');

    // $REALM/ — resolve against the realm root
    if (reference.startsWith('$REALM/')) {
      let path = reference.slice('$REALM/'.length);
      if (isUrlRelativeTo) {
        for (let [, target] of this.realmMappings) {
          if (relativeTo.startsWith(target)) {
            return new URL(path, target).href as RealmResourceIdentifier;
          }
        }
        throw new Error(
          `Cannot resolve "$REALM/" — no realm root found for "${relativeTo}"`,
        );
      }
      for (let [prefix] of this.realmMappings) {
        if (relativeTo.startsWith(prefix)) {
          return (
            prefix.endsWith('/') ? prefix + path : prefix + '/' + path
          ) as RealmResourceIdentifier;
        }
      }
      throw new Error(
        `Cannot resolve "${reference}" — relativeTo "${relativeTo}" has no matching prefix mapping`,
      );
    }

    // relativeTo is a URL — standard URL resolution
    if (isUrlRelativeTo) {
      return new URL(reference, relativeTo).href as RealmResourceIdentifier;
    }

    // relativeTo starts with a registered prefix — resolve in prefix space
    // by round-tripping through URL space: prefix→URL, resolve, URL→prefix
    for (let [prefix, target] of this.realmMappings) {
      if (relativeTo.startsWith(prefix)) {
        let baseURL = new URL(relativeTo.slice(prefix.length), target);
        let resolved = new URL(reference, baseURL);
        // Convert back to scoped form if the resolved URL matches a mapping
        for (let [p, t] of this.realmMappings) {
          if (resolved.href.startsWith(t)) {
            return (p +
              resolved.href.slice(t.length)) as RealmResourceIdentifier;
          }
        }
        return resolved.href as RealmResourceIdentifier;
      }
    }

    throw new Error(
      `Cannot resolve "${reference}" — relativeTo "${relativeTo}" has no matching prefix mapping`,
    );
  }

  private nativeFetch: typeof globalThis.fetch;

  private resolveURLMapping(
    url: string,
    direction: 'virtual-to-real' | 'real-to-virtual',
  ): string | undefined {
    let absoluteURL = new URL(url);
    for (let [virtual, real] of this.urlMappings) {
      let sourcePath = new RealmPaths(
        new URL(direction === 'virtual-to-real' ? virtual : real),
      );
      if (sourcePath.inRealm(absoluteURL)) {
        let toPath = new RealmPaths(
          new URL(direction === 'virtual-to-real' ? real : virtual),
        );
        if (absoluteURL.href.endsWith('/')) {
          return toPath.directoryURL(sourcePath.local(absoluteURL)).href;
        } else {
          let local = sourcePath.local(absoluteURL, {
            preserveQuerystring: true,
          });
          let resolved = toPath.fileURL(local).href;

          // A special case for root realm urls with missing trailing slash, for
          // example http://localhost:4201/base – we want the mapped url also not to have a trailing slash
          // (so that the realm handler knows it needs to redirect to the correct url with a trailing slash)
          if (local === '' && !absoluteURL.pathname.endsWith('/')) {
            resolved = resolved.replace(/\/$/, '');
          }
          return resolved;
        }
      }
    }
    return undefined;
  }

  mount(handler: Handler, opts?: { prepend: boolean }) {
    if (opts?.prepend) {
      this.handlers.unshift(handler);
    } else {
      this.handlers.push(handler);
    }
  }

  unmount(handler: Handler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  fetch: typeof fetch = async (
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ) => {
    // Resolve RRI strings to real URLs before creating the Request,
    // since new Request('@cardstack/base/...') would throw (not a valid URL).
    if (typeof urlOrRequest === 'string') {
      let resolved = this.resolveRRIToURL(urlOrRequest);
      if (resolved) {
        urlOrRequest = resolved;
      }
    }

    let request =
      urlOrRequest instanceof Request
        ? urlOrRequest
        : new Request(urlOrRequest, init);

    let response = await this.runFetch(request, init);

    if (response.url !== request.url) {
      Object.defineProperty(response, 'url', {
        value:
          this.resolveURLMapping(response.url, 'real-to-virtual') ??
          response.url,
      });
    }
    return response;
  };

  private resolveRRIToURL(rri: string): string | undefined {
    for (let [prefix, target] of this.realmMappings) {
      if (rri.startsWith(prefix)) {
        return new URL(rri.slice(prefix.length), target).href;
      }
    }
    return undefined;
  }

  private async runFetch(request: Request, init?: RequestInit) {
    let handlers: FetcherMiddlewareHandler[] = this.handlers.map((h) => {
      return async (request, next) => {
        let response = await h(request);
        if (response) {
          return response;
        }
        return next(request);
      };
    });

    handlers.push(async (request, next) => {
      return next(await this.mapRequest(request, 'virtual-to-real'));
    });

    return withRetries(new URL(request.url), () =>
      fetcher(this.nativeFetch, handlers, this)(request, init),
    );
  }

  // This method is used to handle the boundary between the real and virtual network,
  // when a request is made to the realm from the realm server - it maps requests
  // by changing their URL from real to virtual, as defined in the url mapping config
  // (e.g http://localhost:4201/base to https://cardstack.com/base) so that the realms
  // that have a virtual URL know that they are being requested
  async handle(
    request: Request,
    onMappedRequest?: (request: Request) => void,
  ): Promise<ResponseWithNodeStream> {
    let internalRequest = await this.mapRequest(request, 'real-to-virtual');
    if (onMappedRequest) {
      onMappedRequest(internalRequest);
    }

    for (let handler of this.handlers) {
      let response = await handler(internalRequest);
      if (response) {
        this.mapRedirectionURL(response);
        return response;
      }
    }
    return new Response(undefined, { status: 404 });
  }

  private async mapRequest(
    request: Request,
    direction: 'virtual-to-real' | 'real-to-virtual',
  ) {
    let remappedUrl = this.resolveURLMapping(request.url, direction);

    if (remappedUrl) {
      return await buildRequest(remappedUrl, request);
    } else {
      return request;
    }
  }

  private mapRedirectionURL(response: Response): void {
    if (response.status > 300 && response.status < 400) {
      let redirectionURL = response.headers.get('Location')!;
      let isRelativeRedirectionURL = !/^[a-z][a-z0-9+.-]*:|\/\//i.test(
        redirectionURL,
      ); // doesn't start with a protocol scheme and "//" (e.g., "http://", "https://", "//")

      let finalRedirectionURL;

      if (isRelativeRedirectionURL) {
        finalRedirectionURL = redirectionURL;
      } else {
        let remappedRedirectionURL = this.resolveURLMapping(
          redirectionURL,
          'virtual-to-real',
        );
        finalRedirectionURL = remappedRedirectionURL || redirectionURL;
      }
      response.headers.set('Location', finalRedirectionURL);
    }
  }
}

export function isUrlLike(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('.') ||
    moduleIdentifier.startsWith('/') ||
    moduleIdentifier.startsWith('http://') ||
    moduleIdentifier.startsWith('https://')
  );
}

// This is to handle a very mysterious situation in our CI environment where
// fetches for base realm artifacts seem to vanish and we see "TypeError:
// Fetch failed" exceptions.
//
// Why 10 attempts: with the triangular backoff below (attempt * backOffMs),
// 10 retries widens the total backoff window from ~1.5s to ~5.5s. CI has been
// observed losing localhost:4201/base/* fetches for multi-second stretches
// (TCP/process scheduling glitches), so the prior 5-attempt cap was tight
// enough that a single transient stall would surface as a test timeout.
// Gated on `__environment === 'test'` via shouldRetryFetch, so production
// behaviour is unaffected.
const maxAttempts = 10;
const backOffMs = 100;
const retryableLocalHosts = new Set(['localhost', '127.0.0.1']);

function shouldRetryFetch(url: URL) {
  if ((globalThis as any).__environment !== 'test') {
    return false;
  }

  if (baseRealm.inRealm(url)) {
    return true;
  }

  if (retryableLocalHosts.has(url.hostname)) {
    return true;
  }

  return url.href.startsWith('https://boxel-icons.boxel.ai/');
}

async function withRetries(
  url: URL,
  fetchFn: () => ReturnType<typeof globalThis.fetch>,
) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchFn();
    } catch (err: any) {
      if (!shouldRetryFetch(url) || ++attempt > maxAttempts) {
        if (shouldRetryFetch(url) && attempt > maxAttempts) {
          // Final-exhaustion log: distinct from the per-attempt warning so
          // CI output can be grepped for the actual cap being hit.
          console.error(
            `Exhausted ${attempt - 1} fetch retries for ${url.href}: ${
              err?.name ?? 'Error'
            }: ${err?.message ?? String(err)}`,
          );
        }
        throw err;
      }
      console.error(
        `Encountered fetch failed for ${
          url.href
        } retry attempt #${attempt} in ${attempt * backOffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, attempt * backOffMs));
    }
  }
}

async function buildRequest(url: string, originalRequest: Request) {
  if (url === originalRequest.url) {
    return originalRequest;
  }

  // To reach the goal of creating a new Request but with a different url it is
  // usually enough to create a new Request object with the new url and the same
  // properties as the original request, but there are issues when the body is
  // a ReadableStream - Chrome browser, for example, reports the following error:
  // "TypeError: Failed to construct 'Request': The `duplex` member must be
  // specified for a request with a streaming body." Even adding the `duplex`
  // property will not fix the issue - the browser request being made to
  // our local server then expects HTTP/2 connection which is currently not
  // supported in our local server. To avoid all these issues, we resort to
  // reading the body of the original request and creating a new Request with
  // the new url and the body as a Uint8Array.

  let body = null;
  if (['POST', 'PUT', 'PATCH', 'QUERY'].includes(originalRequest.method)) {
    body = await originalRequest.clone().text();
  }

  return new Request(url, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body,
    referrer: originalRequest.referrer,
    referrerPolicy: originalRequest.referrerPolicy,
    mode: originalRequest.mode,
    credentials: originalRequest.credentials,
    cache: originalRequest.cache,
    redirect: originalRequest.redirect,
    integrity: originalRequest.integrity,
  });
}
