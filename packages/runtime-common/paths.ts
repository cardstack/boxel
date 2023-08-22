interface LocalOptions {
  preserveQuerystring?: boolean;
}
export class RealmPaths {
  readonly url: string;

  constructor(realmURL: string | URL) {
    this.url =
      (typeof realmURL === 'string' ? realmURL : realmURL.href).replace(
        /\/$/,
        '',
      ) + '/';
  }

  local(url: URL | string, opts: LocalOptions = {}): LocalPath {
    if (typeof url === 'string') {
      url = new URL(url);
    }

    if (!url.href.startsWith(this.url)) {
      throw new Error(`bug: realm ${this.url} does not contain ${url.href}`);
    }

    if (opts.preserveQuerystring !== true) {
      // strip query params
      url = new URL(url.pathname, url);
    }

    // this will always remove a leading slash because our constructor ensures
    // this.#realm has a trailing slash.
    let local = url.href.slice(this.url.length);

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
    return url.href.startsWith(this.url);
  }
}

export function join(...pathParts: string[]): LocalPath {
  return pathParts
    .map((p) => p.replace(/^\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .join('/');
}

// Documenting that this represents a local path within realm, with no leading
// slashes or dots and no trailing slash. Example:
//
//    in realm http://example.com/my-realm/ url
//    http://example.com/my-realm/hello/world/ maps to local path "hello/world"
//
export type LocalPath = string;
