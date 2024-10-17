interface LocalOptions {
  preserveQuerystring?: boolean;
}
export class RealmPaths {
  readonly url: string;

  constructor(realmURL: URL) {
    this.url = ensureTrailingSlash(decodeURI(realmURL.href));
  }

  local(url: URL, opts: LocalOptions = {}): LocalPath {
    if (!this.inRealm(url)) {
      let error = new Error(`realm ${this.url} does not contain ${url.href}`);
      (error as any).status = 404;
      throw error;
    }

    if (opts.preserveQuerystring !== true) {
      // strip query params
      url = new URL(decodeURI(url.pathname), url);
    }

    // this will always remove a leading slash because our constructor ensures
    // this.#realm has a trailing slash.
    let local = decodeURI(url.href).slice(this.url.length);

    // this will remove any trailing slashes
    local = local.replace(/\/+$/, '');

    // the LocalPath has no leading nor trailing slashes
    return local;
  }

  fileURL(local: LocalPath): URL {
    return new URL(local, this.url);
  }

  directoryURL(local: LocalPath): URL {
    if (local === '') {
      // this preserves a root that is not at the origin of the URL
      return new URL(this.url);
    }
    return new URL(local + '/', this.url);
  }

  inRealm(url: URL): boolean {
    let decodedHref: string;
    try {
      decodedHref = decodeURI(url.href);
    } catch (e) {
      console.warn(
        `encountered malformed URI ${url} when checking if in realm ${this.url}, treating as not in this realm`,
      );
      return false;
    }
    return (
      decodedHref.startsWith(this.url) ||
      decodedHref.split('?')[0] == this.url.replace(/\/$/, '') // check if url without querystring same as realm url without trailing slash (for detecting root realm urls with missing trailing slash)
    );
  }
}

export function join(...pathParts: string[]): LocalPath {
  return pathParts
    .map((p) => p.replace(/^\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .join('/');
}

function ensureTrailingSlash(realmUrlString: string) {
  return realmUrlString.replace(/\/$/, '') + '/';
}

// Documenting that this represents a local path within realm, with no leading
// slashes or dots and no trailing slash. Example:
//
//    in realm http://example.com/my-realm/ url
//    http://example.com/my-realm/hello/world/ maps to local path "hello/world"
//
export type LocalPath = string;
