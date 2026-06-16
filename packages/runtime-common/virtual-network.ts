import { RealmPaths, ensureTrailingSlash } from './paths.ts';
import { baseRealm } from './index.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { ModuleDescriptor } from './package-shim-handler.ts';
import {
  PackageShimHandler,
  PACKAGES_FAKE_ORIGIN,
  type ModuleLike,
} from './package-shim-handler.ts';
import type { Readable } from 'stream';
import { fetcher, type FetcherMiddlewareHandler } from './fetcher.ts';
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
  // Memo for toURLHref. Hot paths (module-graph walks, per-instance realm
  // membership checks) resolve the same identifiers over and over and only
  // ever need the href STRING, yet toURL pays a native `new URL()` per call —
  // in large renders that constructor shows up as a top self-time frame, and
  // the discarded URL objects feed GC pressure. Caching the resolved href
  // turns every repeat into a Map lookup with zero allocation. Resolution is
  // a pure function of the realm mappings, so entries stay valid until a
  // mapping is added or removed (both clear the cache).
  private toURLHrefCache = new Map<string, string>();

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
   * Register a scoped realm prefix and its target URL. Populates the
   * realm mapping (used by `resolveURL` / `toURL` / `unresolveURL` /
   * `isRegisteredPrefix`) and the import map (used by module loading).
   * Does NOT add a URL-to-URL mapping — use `addURLMapping` separately
   * when a virtual URL (e.g. `https://cardstack.com/base/`) needs to
   * map to a real URL.
   */
  addRealmMapping(realmIdentifier: string, targetURL: string): void {
    let normalizedId = ensureTrailingSlash(realmIdentifier);
    let normalizedTarget = ensureTrailingSlash(targetURL);
    this.realmMappings.set(normalizedId, normalizedTarget);
    this.toURLHrefCache.clear();
    this.addImportMap(
      normalizedId,
      (rest) => new URL(rest, normalizedTarget).href,
    );
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
    this.toURLHrefCache.clear();
  }

  knownRealms(): RealmIdentifier[] {
    return [...this.realmMappings.keys()] as RealmIdentifier[];
  }

  /**
   * Whether `reference` starts with one of this VN's registered realm
   * prefixes (e.g. `@cardstack/base/foo` against a registered
   * `@cardstack/base/` mapping).
   */
  isRegisteredPrefix(reference: string): boolean {
    for (let [prefix] of this.realmMappings) {
      if (reference.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Convert a resolved URL back to its registered prefix form when one
   * matches, e.g. `http://localhost:4201/catalog/foo` → `@cardstack/catalog/foo`.
   * URLs that don't match any registered prefix are returned as-is.
   */
  unresolveURL(url: string): RealmResourceIdentifier {
    for (let [prefix, target] of this.realmMappings) {
      if (url.startsWith(target)) {
        return (prefix + url.slice(target.length)) as RealmResourceIdentifier;
      }
    }
    return url as RealmResourceIdentifier;
  }

  /**
   * Resolve `reference` (relative path, prefix-form RRI, or URL string)
   * to a canonical URL object using `relativeTo` as the base when
   * `reference` is relative. Composes `resolveRRI` + `toURL`, with a
   * direct URL-join path for the `/`-rooted-reference cases that
   * `resolveRRI` declines to handle (see the body comment below).
   */
  resolveURL(reference: string, relativeTo: URL | string | undefined): URL {
    let base: RealmResourceIdentifier | undefined;
    if (relativeTo instanceof URL) {
      base = relativeTo.href as RealmResourceIdentifier;
    } else if (typeof relativeTo === 'string') {
      base = relativeTo as RealmResourceIdentifier;
    }
    // `/`-rooted references are not valid RRI forms — `resolveRRI`
    // rejects them — but they're legitimate URL-form inputs. Handle
    // them here: if the base is URL-form, URL-join directly; if it's a
    // registered prefix, resolve the prefix to its mapped URL first
    // and then join. Unmapped prefix-form bases fall through to
    // `resolveRRI`, which raises "no matching prefix mapping".
    if (
      reference.startsWith('/') &&
      !reference.startsWith('//') &&
      typeof base === 'string'
    ) {
      if (base.startsWith('http://') || base.startsWith('https://')) {
        return new URL(reference, base);
      }
      let mapped = this.resolveRRIToURL(base);
      if (mapped !== undefined) {
        return new URL(reference, mapped);
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
   */
  toURL(rri: string): URL {
    let resolved = this.resolveRRIToURL(rri);
    if (resolved !== undefined) {
      return new URL(resolved);
    }
    // Not a registered prefix; parse as a plain URL.
    return new URL(rri);
  }

  /**
   * `toURL().href` without constructing a URL object on repeats. Same
   * resolution and same throw-on-unresolvable behavior as `toURL`, but
   * memoized — for callers that only need the href string this turns the
   * per-call native URL construction into a Map lookup. Failures are not
   * cached, so an identifier that becomes resolvable after a mapping is
   * registered resolves normally.
   */
  toURLHref(rri: string): string {
    let cached = this.toURLHrefCache.get(rri);
    if (cached !== undefined) {
      return cached;
    }
    let href = this.toURL(rri).href;
    this.toURLHrefCache.set(rri, href);
    return href;
  }

  /**
   * Resolve a reference to an absolute `RealmResourceIdentifier`.
   *
   * Resolution rules:
   * - Absolute URL or registered prefix → return as-is
   * - Relative (`./`, `../`, bare name) → resolve against `relativeTo`
   * - `$REALM/` → resolve against the realm root of `relativeTo`
   * - `/` or `~/` prefixed → throw (not valid RRI forms)
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
        this,
      );
      if (sourcePath.inRealm(absoluteURL)) {
        let toPath = new RealmPaths(
          new URL(direction === 'virtual-to-real' ? real : virtual),
          this,
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
