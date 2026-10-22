import {
  canonicalRRIImportMap,
  parseRRI,
  realmRRI,
  type RRIImportMap,
} from '@cardstack/deck';

import {
  routeVersion,
  type DeckPackageResolver,
  type DeckRoutes,
} from './deck-package-resolver.ts';
import { parseExactVersionTransportURL } from './deck-version-url.ts';

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
 * Discovers a package's lock from a response, and installs it before the
 * module that response carries is transpiled.
 *
 * package.json owns the mutable package name. importmap.json owns exact
 * dependency selections. A package's top-level `imports` are installed as a
 * scope for that package root, never as process-global imports, so two packages
 * (or two exact Versions of one package) can carry different locks at once.
 *
 * The lock goes into a DeckPackageResolver. The network is reached only through
 * DeckRoutes, to register the prefixes the lock's RRIs need.
 */
export class DynamicRRIResolution {
  private contexts = new Map<string, PackageContext>();
  private pending = new Map<string, Promise<void>>();
  private prepared = new Set<string>();
  private resolver: DeckPackageResolver;
  private routes: DeckRoutes;
  private fetch: Fetch;
  private enabled: boolean;

  constructor(
    resolver: DeckPackageResolver,
    routes: DeckRoutes,
    fetch: Fetch,
    options: DynamicRRIResolutionOptions = {},
  ) {
    this.resolver = resolver;
    this.routes = routes;
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
    let key = transportRootURL;
    let inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }
    if (this.prepared.has(key)) {
      return;
    }

    let preparation = this.discoverAndInstall({
      exactRootRRI: exact ? parseRRI(exact.identifier).root : undefined,
      mutableRealmURL: ensureTrailingSlash(realmURL),
      transportRootURL,
    }).finally(() => this.pending.delete(key));
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
    this.routes.addRealmMapping(mutableRootRRI, options.mutableRealmURL);
    // A module served from an exact Version must be identified by that
    // Version's RRI, or its imports would be resolved against the mutable
    // package's scope instead of its own sealed lock.
    if (options.exactRootRRI) {
      this.routes.addRealmMapping(
        options.exactRootRRI,
        options.transportRootURL,
      );
    }
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
    let known = new Set<string>(this.routes.knownRealms());
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
      this.routes.addRealmMapping(mutableRootRRI, transport.href);
      known.add(mutableRootRRI);
    }
    // Register every exact Version root now, before any of them is fetched, so
    // no module is cached under a target when its prefix is added.
    for (let target of targets) {
      routeVersion(this.routes, target);
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
    this.resolver.setLock({
      imports: {},
      scopes,
      ...(Object.keys(integrity).length > 0 ? { integrity } : {}),
    });
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
