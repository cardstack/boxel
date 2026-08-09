import { init, parse } from 'es-module-lexer';

let lexerReady = Promise.resolve(init);

/**
 * Exact read authority for one Sandbox module graph.
 *
 * The Host seeds the graph from source classification. Each admitted module
 * may then add only the literal ESM dependencies present in its own response.
 * This matches ordinary module-loader semantics without exposing a general
 * authenticated fetch capability to the child process.
 */
export default class SandboxModuleAuthority {
  private readonly modules = new Set<string>();

  constructor(
    private readonly resolveModuleURL: (identifier: string) => string,
    private readonly isTrustedModuleURL: (identifier: string) => boolean,
  ) {}

  allow(moduleIdentifiers: readonly string[]): void {
    for (let identifier of moduleIdentifiers) {
      this.add(identifier);
      this.add(this.resolveModuleURL(identifier));
    }
  }

  has(identifier: string): boolean {
    let resolvedIdentifier = this.resolveModuleURL(identifier);
    return (
      this.isTrustedModuleURL(identifier) ||
      this.isTrustedModuleURL(resolvedIdentifier) ||
      this.modules.has(canonicalModuleURL(identifier) ?? '') ||
      this.modules.has(canonicalModuleURL(resolvedIdentifier) ?? '')
    );
  }

  async observe(
    moduleIdentifier: string,
    contentType: string | null,
    body: ArrayBuffer,
  ): Promise<void> {
    if (!isJavaScript(contentType, moduleIdentifier)) {
      return;
    }
    await lexerReady;
    let source = new TextDecoder().decode(body);
    let imports;
    try {
      imports = parse(source)[0];
    } catch {
      return;
    }
    for (let entry of imports) {
      if (typeof entry.n !== 'string' || !isResolvableSpecifier(entry.n)) {
        // A bare specifier (`three`, `lodash-es`) is not a relative or
        // absolute reference into this response's own origin — resolving it
        // against `moduleIdentifier` with `new URL()` does not throw (it
        // silently treats the bare name as a same-origin sibling path,
        // admitting a URL nothing will ever actually request) and does not
        // reach it either: bare packages remain inside VirtualNetwork's
        // package shim handler, a different resolution path this observed
        // response never goes through. Leave it unadmitted rather than
        // manufacture a URL for it.
        continue;
      }
      try {
        this.add(new URL(entry.n, moduleIdentifier).href);
      } catch {
        // A malformed specifier resolves to nothing.
      }
    }
  }

  /**
   * Discards every admitted URL. Used only by an explicit hard reload
   * (`SandboxRuntimeProcess.reloadSandbox()`) — an ordinary HMR draft push
   * only ever grows this set (see `allow()`), never shrinks it, matching
   * "never widen beyond the literal reachable graph" without also having
   * to track and revoke URLs a since-edited module no longer imports.
   */
  reset(): void {
    this.modules.clear();
  }

  private add(identifier: string): void {
    let canonical = canonicalModuleURL(identifier);
    if (canonical) {
      this.modules.add(canonical);
    }
  }
}

function canonicalModuleURL(identifier: string): string | undefined {
  try {
    let url = new URL(identifier);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return undefined;
    }
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

// A specifier this response's own imports can be trusted to name a fetchable
// URL for: a relative path, a root-relative path, or an absolute URL. A bare
// specifier (`three`) is none of these — `new URL(bareSpecifier, base)`
// resolves it anyway (treating it as a same-origin sibling segment) rather
// than throwing, so this must be checked explicitly before that call.
function isResolvableSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(specifier)
  );
}

// A binary asset content-type never parses as an ES module; skip the lexer
// for it. Every other response is attempted. This is deliberately not an
// allowlist of "known-JS" CDN hosts or extensions: third-party ESM CDNs vary
// in how (or whether) they label a response `javascript`, and in which URLs
// carry a recognizable extension at all — jsdelivr's `/+esm` bundles, for
// one, have neither a `javascript`-only content-type guarantee nor a file
// extension, the same shape unpkg's `?module` and skypack's pinned URLs take.
// Admission growth generalizes to "did this response actually parse as an ES
// module" (the `parse()` call in `observe()`, below) rather than maintaining
// a hardcoded list of CDN hosts that happen to work today.
const nonModuleContentType = /^(?:image|audio|video|font)\//i;

function isJavaScript(contentType: string | null, identifier: string): boolean {
  if (/\.(?:gjs|gts|js|mjs|ts)(?:$|[?#])/.test(identifier)) {
    return true;
  }
  return !contentType || !nonModuleContentType.test(contentType);
}
