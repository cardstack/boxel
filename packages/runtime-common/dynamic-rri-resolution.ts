import {
  canonicalRRIImportMap,
  parseRRI,
  realmRRI,
  type RRIImportMap,
} from '@cardstack/deck';

import { parseExactVersionTransportURL } from './deck-version-url.ts';
import type { VirtualNetwork } from './virtual-network.ts';

type Fetch = typeof globalThis.fetch;

type PackageContext = {
  packageRootRRI: string;
  transportRootURL: string;
  lock: RRIImportMap;
};

interface DynamicRRIResolutionOptions {
  enabled?: boolean;
}

/**
 * Installs package-owned RRI resolution just before Loader evaluates a module.
 *
 * package.json owns the mutable package name. importmap.json owns exact
 * dependency selections. A package's top-level `imports` are installed as a
 * scope for that package root, never as process-global imports, so two packages
 * (or two exact Versions of one package) can carry different locks at once.
 */
export class DynamicRRIResolution {
  private contexts = new Map<string, PackageContext>();
  private pending = new Map<string, Promise<void>>();
  private prepared = new Set<string>();
  private virtualNetwork: VirtualNetwork;
  private fetch: Fetch;
  private enabled: boolean;

  constructor(
    virtualNetwork: VirtualNetwork,
    fetch: Fetch,
    options: DynamicRRIResolutionOptions = {},
  ) {
    this.virtualNetwork = virtualNetwork;
    this.fetch = fetch;
    this.enabled = options.enabled === true;
  }

  /**
   * Forget discovery results after a live write. Installed resolution remains
   * valid until the next module response atomically replaces that package's
   * context, avoiding a window where already-running modules lose their lock.
   */
  invalidate(): void {
    this.pending.clear();
    this.prepared.clear();
  }

  async prepare(moduleURL: URL, response: Response): Promise<void> {
    if (!this.enabled) {
      return;
    }
    let realmURL = response.headers.get('X-Boxel-Realm-Url');
    if (!realmURL) {
      return;
    }

    let exact = parseExactVersionTransportURL(moduleURL);
    let transportRootURL =
      exact?.packageURL.href ?? ensureTrailingSlash(realmURL);
    return this.prepareContext({
      exactRootRRI: exact ? parseRRI(exact.identifier).root : undefined,
      mutableRealmURL: ensureTrailingSlash(realmURL),
      transportRootURL,
    });
  }

  /**
   * Bootstrap a known Realm before a persisted RRI is first resolved. This is
   * the cold-start counterpart to response-driven prepare(): operator-mode
   * state can contain an RRI before loading that card has produced a response.
   */
  async prepareRealm(realmURL: URL): Promise<void> {
    if (!this.enabled) {
      return;
    }
    let transportRootURL = ensureTrailingSlash(realmURL.href);
    return this.prepareContext({
      mutableRealmURL: transportRootURL,
      transportRootURL,
    });
  }

  private async prepareContext(options: {
    exactRootRRI?: string;
    mutableRealmURL: string;
    transportRootURL: string;
  }): Promise<void> {
    let key = options.transportRootURL;
    let inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }
    if (this.prepared.has(key)) {
      return;
    }

    let preparation = this.discoverAndInstall(options).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, preparation);
    return preparation;
  }

  private async discoverAndInstall(options: {
    exactRootRRI?: string;
    mutableRealmURL: string;
    transportRootURL: string;
  }): Promise<void> {
    let packageResponse = await this.fetch(
      new URL('package.json', options.transportRootURL),
    );
    // Ordinary Boxel realms remain valid without Deck package metadata.
    if (!packageResponse.ok) {
      return;
    }
    let packageJSON = (await packageResponse.json()) as { name?: unknown };
    if (typeof packageJSON.name !== 'string') {
      return;
    }
    let mutableRootRRI = realmRRI(`${packageJSON.name}/`);

    let capabilityResponse = await this.fetch(
      new URL('.deck/capabilities', options.mutableRealmURL),
    );
    let capability: { deckCollaboration?: unknown; realmRRI?: unknown } = {};
    if (capabilityResponse.ok) {
      try {
        capability = (await capabilityResponse.json()) as typeof capability;
      } catch {
        return;
      }
    }
    if (
      !capabilityResponse.ok ||
      capabilityResponse.headers.get('x-boxel-deck-collaboration') !== 'true' ||
      capability.deckCollaboration !== true ||
      capability.realmRRI !== mutableRootRRI
    ) {
      return;
    }

    let packageRootRRI = options.exactRootRRI ?? mutableRootRRI;
    let importMapResponse = await this.fetch(
      new URL('importmap.json', options.transportRootURL),
    );
    let lock = importMapResponse.ok
      ? canonicalRRIImportMap(await importMapResponse.json(), {
          relativeTo: packageRootRRI,
        })
      : { imports: {}, scopes: {} };

    // Both identities are useful: the mutable mapping gives agents and live
    // code a stable name, while the exact mapping makes an immutable module's
    // importer identity exact before its dependencies are resolved.
    this.virtualNetwork.addRealmMapping(
      mutableRootRRI,
      options.mutableRealmURL,
    );
    this.installDependencyMappings(lock, options.mutableRealmURL);

    this.contexts.set(options.transportRootURL, {
      packageRootRRI,
      transportRootURL: options.transportRootURL,
      lock,
    });
    this.prepared.add(options.transportRootURL);
    this.installCombinedLock();
  }

  private installDependencyMappings(
    lock: RRIImportMap,
    importingRealmURL: string,
  ): void {
    let known = new Set<string>(this.virtualNetwork.knownRealms());
    let targets = [
      ...Object.values(lock.imports),
      ...Object.values(lock.scopes).flatMap((table) => Object.values(table)),
    ];
    for (let target of targets) {
      let parsed = parseRRI(target);
      let mutableRootRRI = `@${parsed.scope}/${parsed.name}/`;
      if (known.has(mutableRootRRI)) {
        continue;
      }
      // A realm server is the authoritative package directory. Its canonical
      // route shape mirrors RRI identity, so a package lock needs no transport
      // URL. The first response from that dependency confirms its package
      // metadata and installs any exact-Version context of its own.
      let transport = new URL(
        `/${parsed.scope}/${parsed.name}/`,
        importingRealmURL,
      );
      this.virtualNetwork.addRealmMapping(mutableRootRRI, transport.href);
      known.add(mutableRootRRI);
    }
  }

  private installCombinedLock(): void {
    let scopes: RRIImportMap['scopes'] = {};
    let integrity: NonNullable<RRIImportMap['integrity']> = {};
    for (let context of this.contexts.values()) {
      scopes[context.packageRootRRI] = { ...context.lock.imports };
      for (let [scope, table] of Object.entries(context.lock.scopes)) {
        scopes[scope] = { ...(scopes[scope] ?? {}), ...table };
      }
      Object.assign(integrity, context.lock.integrity ?? {});
    }
    this.virtualNetwork.setRRIImportMap({
      imports: {},
      scopes,
      ...(Object.keys(integrity).length > 0 ? { integrity } : {}),
    });
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
