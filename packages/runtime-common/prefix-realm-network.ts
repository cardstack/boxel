/**
 * The prefix map a realm server serves, and the network a client builds from
 * it.
 *
 * A process with no VirtualNetwork of its own — boxel-cli, the VS Code
 * extension — still has to turn `@cardstack/catalog/…` into the URL the
 * catalog realm is served at. ADR 002 §1.2 rules out deriving that URL from
 * the prefix's spelling: a realm server can serve a prefix realm anywhere, and
 * a guessed URL fails only when a request goes to the wrong place. Instead the
 * realm server publishes its own realm mappings at `/_prefix-realms`, and the
 * client registers each entry with `addRealmMapping`, the same way the host
 * registers its prefixes from the served index HTML. The URL behind a prefix
 * then lives on a network and nowhere else (ADR 002 §1.4).
 *
 * `PrefixRealmNetwork` carries the prefix resolution of `VirtualNetwork` — the
 * mapping table, `toURL`, `realmForReference` — and none of its request
 * handling. It is a separate class because `VirtualNetwork` reaches the
 * runtime-common barrel and the shimmed-module machinery, whose imports the
 * dependency-light consumers cannot resolve (see the note on
 * `RealmPathsVirtualNetwork` in `paths.ts`). It satisfies that interface, so
 * `RealmPaths` accepts it. ADR 002 §1.2 names it as the network such a client
 * builds.
 *
 * Given the same prefix map, its methods answer as `VirtualNetwork`'s do, with
 * one difference: it holds no URL mappings, because the map it is built from
 * carries prefixes only, so it knows a realm only by its prefix and the URL it
 * is served at, never by an alias. For a reference into
 * the base realm, `VirtualNetwork.realmForReference` answers the alias the
 * realm is known by (`https://cardstack.com/base/`) and this answers where it
 * is served, which is what a caller fetching through the answer needs; and
 * `unresolveURL` leaves an alias URL as written. The shared tests run both
 * classes over the same cases, and pin that difference.
 *
 * This module imports only leaf modules. Keep it that way, or the consumers it
 * exists for lose it.
 */

import { ensureTrailingSlash } from './paths.ts';
import {
  isPrefixForm,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from './realm-identifiers.ts';
import { SupportedMimeType } from './supported-mime-type.ts';

/** The endpoint's path below the realm server's URL. */
export const PREFIX_REALMS_ENDPOINT = '_prefix-realms';

export interface PrefixRealmResource {
  type: 'prefix-realm';
  /** The registered prefix, with its trailing slash. */
  id: string;
  attributes: {
    /** The URL the realm is served at, with its trailing slash. */
    realmURL: string;
  };
}

/** The JSON:API document `/_prefix-realms` serves. */
export interface PrefixRealmsDocument {
  data: PrefixRealmResource[];
}

/**
 * The part of a network the map is read off. `VirtualNetwork` and
 * `PrefixRealmNetwork` both provide it.
 */
export interface PrefixRealmSource {
  knownRealms(): RealmIdentifier[];
  toURLHref(rri: string): string;
}

/**
 * Each registered prefix and the URL its realm is served at, read off a
 * network. Realms registered under a URL rather than a prefix are left out:
 * they need no map to be reached.
 */
export function prefixRealmURLsOf(
  network: PrefixRealmSource,
): Record<string, string> {
  let prefixRealmURLs: Record<string, string> = {};
  for (let prefix of network.knownRealms()) {
    if (isPrefixForm(prefix)) {
      prefixRealmURLs[prefix] = network.toURLHref(prefix);
    }
  }
  return prefixRealmURLs;
}

export function prefixRealmsDocument(
  network: PrefixRealmSource,
): PrefixRealmsDocument {
  return {
    data: Object.entries(prefixRealmURLsOf(network)).map(
      ([prefix, realmURL]) => ({
        type: 'prefix-realm',
        id: prefix,
        attributes: { realmURL },
      }),
    ),
  };
}

/**
 * The map a `/_prefix-realms` response carries. Throws when the body is not
 * the document the endpoint serves, naming `source` so the error says which
 * server answered.
 */
export function prefixRealmURLsFromDocument(
  document: unknown,
  source: string,
): Record<string, string> {
  let data = (document as Partial<PrefixRealmsDocument> | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error(`${source} did not answer with a prefix realm document`);
  }
  let prefixRealmURLs: Record<string, string> = {};
  for (let resource of data as Partial<PrefixRealmResource>[]) {
    let prefix = resource?.id;
    let realmURL = resource?.attributes?.realmURL;
    if (
      resource?.type !== 'prefix-realm' ||
      typeof prefix !== 'string' ||
      !isPrefixForm(prefix) ||
      typeof realmURL !== 'string'
    ) {
      throw new Error(
        `${source} answered with a malformed prefix realm entry: ${JSON.stringify(resource)}`,
      );
    }
    prefixRealmURLs[prefix] = realmURL;
  }
  return prefixRealmURLs;
}

/**
 * A network that resolves registered prefixes and nothing else. See the module
 * comment for why this is not `VirtualNetwork`.
 */
export class PrefixRealmNetwork {
  private realmMappings = new Map<string, string>();

  constructor(prefixRealmURLs: Record<string, string> = {}) {
    for (let [prefix, realmURL] of Object.entries(prefixRealmURLs)) {
      this.addRealmMapping(prefix, realmURL);
    }
  }

  /** Register where the realm behind `prefix` is served. */
  addRealmMapping(prefix: string, realmURL: string): void {
    this.realmMappings.set(
      ensureTrailingSlash(prefix),
      ensureTrailingSlash(realmURL),
    );
  }

  /** The realms this network can resolve. */
  knownRealms(): RealmIdentifier[] {
    return [...this.realmMappings.keys()] as RealmIdentifier[];
  }

  /**
   * The mapping table as the map `/_prefix-realms` serves, for a consumer that
   * takes the map rather than the network, such as the realm-source staging.
   */
  prefixRealmURLs(): Record<string, string> {
    return Object.fromEntries(this.realmMappings);
  }

  /**
   * The URL of the realm holding `reference`, matched against each registered
   * prefix and its target, longest match first. Answers the URL the realm is
   * served at, never an alias (see the module comment), so a caller can fetch
   * through it or compare it against a realm's own URL. Undefined when no
   * registered realm holds the reference.
   */
  realmForReference(reference: string): RealmIdentifier | undefined {
    let best: string | undefined;
    let bestLength = -1;
    for (let [prefix, target] of this.realmMappings) {
      for (let addressable of [prefix, target]) {
        if (
          reference.startsWith(addressable) &&
          addressable.length > bestLength
        ) {
          bestLength = addressable.length;
          best = target;
        }
      }
    }
    return best as RealmIdentifier | undefined;
  }

  /**
   * The path of `identifier` below its namespace: below `@scope/name/` for a
   * prefix-form identifier, and below `scheme://authority` for a URL, with no
   * leading slash. Reads the spelling only, so a prefix-form identifier never
   * goes through a URL parser.
   */
  pathBelowNamespace(identifier: string): string {
    if (isPrefixForm(identifier)) {
      return identifier.split('/').slice(2).join('/');
    }
    let path: string;
    try {
      // Prefix forms return above, so this parses a URL or something that is
      // neither, which the catch keeps as written.
      // eslint-disable-next-line @cardstack/boxel/no-url-from-realm-identifier
      path = new URL(identifier).pathname;
    } catch {
      return identifier.replace(/^\//, '');
    }
    try {
      path = decodeURI(path);
    } catch {
      // A malformed escape keeps the path as written.
    }
    return path.replace(/^\//, '');
  }

  /**
   * Convert an RRI to a URL. A prefix-form RRI resolves through the registered
   * mappings; a URL-form RRI parses directly. Throws when the prefix is not
   * registered and the value is not a URL.
   */
  toURL(rri: string): URL {
    for (let [prefix, target] of this.realmMappings) {
      if (rri.startsWith(prefix)) {
        return new URL(rri.slice(prefix.length), target);
      }
    }
    try {
      // Not a registered prefix, so this is a URL-form identifier or an error.
      // eslint-disable-next-line @cardstack/boxel/no-url-from-realm-identifier
      return new URL(rri);
    } catch {
      throw new Error(
        `cannot resolve ${JSON.stringify(rri)} to a URL: it is not a URL, and ` +
          `no registered realm prefix matches it (registered: ` +
          `${[...this.realmMappings.keys()].join(', ')})`,
      );
    }
  }

  toURLHref(rri: string): string {
    return this.toURL(rri).href;
  }

  /**
   * A URL back in its registered prefix form when a registered realm serves
   * it; otherwise the input as given.
   */
  unresolveURL(url: string): RealmResourceIdentifier {
    for (let [prefix, target] of this.realmMappings) {
      if (url.startsWith(target)) {
        return `${prefix}${url.slice(target.length)}` as RealmResourceIdentifier;
      }
    }
    return url as RealmResourceIdentifier;
  }
}

/**
 * How long a read of the map may take, end to end. The map is read ahead of
 * work that promises to degrade, not stall, when a realm server hangs — the
 * realm-source staging gives each of its own requests the same budget — and a
 * read that never settles would hold every caller sharing it (see
 * `prefixRealmNetworkFor`).
 */
export const PREFIX_REALMS_TIMEOUT_MS = 10_000;

/**
 * Read the prefix map `realmServerURL` serves. Throws when it cannot, naming
 * the URL it asked, including when the server does not answer within
 * `timeoutMs`.
 */
export async function fetchPrefixRealmURLs(
  realmServerURL: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs: number = PREFIX_REALMS_TIMEOUT_MS,
): Promise<Record<string, string>> {
  let url = new URL(PREFIX_REALMS_ENDPOINT, ensureTrailingSlash(realmServerURL))
    .href;
  let failure = (cause: unknown) =>
    new Error(
      `Could not read the prefix realm map from ${url}: ${describeFailure(cause)}`,
    );
  // One signal for the request and its body, so a server that sends headers
  // and then stalls is bounded too.
  let signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: SupportedMimeType.JSONAPI },
      signal,
    });
  } catch (error: unknown) {
    throw failure(error);
  }
  if (!response.ok) {
    throw failure(`HTTP ${response.status}`);
  }
  let document: unknown;
  try {
    document = await response.json();
  } catch (error: unknown) {
    throw failure(error);
  }
  return prefixRealmURLsFromDocument(document, url);
}

// A failed `fetch` says only "fetch failed"; what failed — a refused
// connection, a DNS miss — is on its `cause`.
function describeFailure(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (!(error instanceof Error)) {
    return String(error);
  }
  let cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error
    ? `${error.message} (${cause.message})`
    : error.message;
}

// One network per realm server for the life of the process: a CLI invocation
// resolves several identifiers against the same server, and the map changes
// only when the server is reconfigured. Every caller shares the read in
// flight, so it must settle: `fetchPrefixRealmURLs` bounds it, and a failed or
// timed-out read is dropped so the next call asks again.
const networksByServer = new Map<string, Promise<PrefixRealmNetwork>>();

/**
 * The network built from the prefix map `realmServerURL` serves, read once per
 * process. Rejects when the map cannot be read, or is not read within
 * `timeoutMs`.
 */
export function prefixRealmNetworkFor(
  realmServerURL: string,
  fetchFn?: typeof globalThis.fetch,
  timeoutMs?: number,
): Promise<PrefixRealmNetwork> {
  let key = ensureTrailingSlash(realmServerURL);
  let pending = networksByServer.get(key);
  if (!pending) {
    let attempt = fetchPrefixRealmURLs(key, fetchFn, timeoutMs).then(
      (prefixRealmURLs) => new PrefixRealmNetwork(prefixRealmURLs),
    );
    attempt.catch(() => {
      if (networksByServer.get(key) === attempt) {
        networksByServer.delete(key);
      }
    });
    networksByServer.set(key, attempt);
    pending = attempt;
  }
  return pending;
}

/** Exported for tests; a process otherwise keeps its networks for its lifetime. */
export function clearPrefixRealmNetworkCache(): void {
  networksByServer.clear();
}
