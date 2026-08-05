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
    return (
      this.isTrustedModuleURL(identifier) ||
      this.modules.has(canonicalModuleURL(identifier) ?? '')
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
      if (typeof entry.n !== 'string') {
        continue;
      }
      try {
        this.add(new URL(entry.n, moduleIdentifier).href);
      } catch {
        // Bare packages remain inside VirtualNetwork's package shim handler.
      }
    }
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

function isJavaScript(contentType: string | null, identifier: string): boolean {
  return (
    contentType?.includes('javascript') === true ||
    /\.(?:gjs|gts|js|mjs|ts)(?:$|[?#])/.test(identifier) ||
    new URL(identifier).hostname === 'esm.sh'
  );
}
