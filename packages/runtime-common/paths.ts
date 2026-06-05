import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers';

interface LocalOptions {
  preserveQuerystring?: boolean;
}

// Structural subset of VirtualNetwork that RealmPaths needs. Declared
// locally so paths.ts doesn't take a direct import edge on virtual-network
// (which would transitively pull base-realm URL imports into consumers
// that only need URL-handling, like @cardstack/boxel-cli).
interface RealmPathsVirtualNetwork {
  toURL(rri: string): URL;
}

export class RealmPaths {
  readonly url: string;
  private virtualNetwork: RealmPathsVirtualNetwork | undefined;

  constructor(realmURL: URL, virtualNetwork?: RealmPathsVirtualNetwork);
  constructor(
    realmId: RealmIdentifier,
    virtualNetwork?: RealmPathsVirtualNetwork,
  );
  constructor(
    realmURLOrId: URL | RealmIdentifier,
    virtualNetwork?: RealmPathsVirtualNetwork,
  ) {
    if (realmURLOrId instanceof URL) {
      this.url = ensureTrailingSlash(decodeURI(realmURLOrId.href));
    } else {
      this.url = ensureTrailingSlash(realmURLOrId);
    }
    this.virtualNetwork = virtualNetwork;
  }

  get realmId(): RealmIdentifier {
    return this.url as RealmIdentifier;
  }

  private get isURLBased(): boolean {
    return this.url.startsWith('http://') || this.url.startsWith('https://');
  }

  private assertURLBased(method: string): void {
    if (!this.isURLBased) {
      throw new Error(
        `${method}() requires a URL-based RealmPaths, but this instance was constructed from a scoped RealmIdentifier ("${this.url}"). Use the RRI-aware methods instead (e.g. fileRRI, directoryRRI, localFromRRI, inRealmRRI).`,
      );
    }
  }

  local(
    input: RealmResourceIdentifier | URL,
    opts: LocalOptions = {},
  ): LocalPath {
    if (input instanceof URL) {
      this.assertURLBased('local');
      if (!this.inRealm(input)) {
        let error = new Error(
          `realm ${this.url} does not contain ${input.href}`,
        );
        (error as any).status = 404;
        throw error;
      }

      if (opts.preserveQuerystring !== true) {
        // strip query params
        input = new URL(decodeURI(input.pathname), input);
      }

      // this will always remove a leading slash because our constructor ensures
      // this.#realm has a trailing slash.
      let local = decodeURI(input.href).slice(this.url.length);

      // this will remove any trailing slashes
      local = local.replace(/\/+$/, '');

      // the LocalPath has no leading nor trailing slashes
      return local;
    }
    if (!this.inRealm(input)) {
      let error = new Error(`realm ${this.url} does not contain ${input}`);
      (error as any).status = 404;
      throw error;
    }
    let local = decodeURI(input).slice(this.url.length);
    return local.replace(/\/+$/, '');
  }

  fileURL(local: LocalPath): URL {
    this.assertURLBased('fileURL');
    return new URL(local, this.url);
  }

  directoryURL(local: LocalPath): URL {
    this.assertURLBased('directoryURL');
    if (local === '') {
      // this preserves a root that is not at the origin of the URL
      return new URL(this.url);
    }
    return new URL(local + '/', this.url);
  }

  inRealm(input: RealmResourceIdentifier | URL): boolean {
    let inputStr = input instanceof URL ? input.href : input;
    let decoded: string;
    try {
      decoded = decodeURI(inputStr);
    } catch {
      return false;
    }
    // Same-form fast path: both sides URL or both prefix.
    if (
      decoded.startsWith(this.url) ||
      // realm root with missing trailing slash, optionally with query string
      decoded.split('?')[0] === this.url.replace(/\/$/, '')
    ) {
      return true;
    }
    // Cross-form: needs a VirtualNetwork to normalize prefix-form ↔ URL-form.
    // Without one, this RealmPaths only resolves same-form membership.
    if (!this.virtualNetwork) {
      return false;
    }
    let realmURL: string;
    let inputURL: string;
    try {
      realmURL = this.virtualNetwork.toURL(this.url).href;
      inputURL = this.virtualNetwork.toURL(inputStr).href;
    } catch {
      return false;
    }
    let decodedURL: string;
    try {
      decodedURL = decodeURI(inputURL);
    } catch {
      return false;
    }
    return (
      decodedURL.startsWith(realmURL) ||
      decodedURL.split('?')[0] === realmURL.replace(/\/$/, '')
    );
  }

  fileRRI(local: LocalPath): RealmResourceIdentifier {
    if (this.isURLBased) {
      return new URL(local, this.url).href as RealmResourceIdentifier;
    }
    return (this.url + local) as RealmResourceIdentifier;
  }

  directoryRRI(local: LocalPath): RealmResourceIdentifier {
    if (local === '') {
      return this.url as RealmResourceIdentifier;
    }
    if (this.isURLBased) {
      return new URL(local + '/', this.url).href as RealmResourceIdentifier;
    }
    return (this.url + local + '/') as RealmResourceIdentifier;
  }
}

export function join(...pathParts: string[]): LocalPath {
  return pathParts
    .map((p) => p.replace(/^\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .join('/');
}

export function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

// Documenting that this represents a local path within realm, with no leading
// slashes or dots and no trailing slash. Example:
//
//    in realm http://example.com/my-realm/ url
//    http://example.com/my-realm/hello/world/ maps to local path "hello/world"
//
export type LocalPath = string;
