import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import {
  hostRouteLink,
  isCardInstance,
  logger,
  registerHostRouteLinks,
  runtimeNonQueryDependencyContext,
  type CardAPIForMatching,
  type HostRoute,
  type HostRouteAddressTarget,
  type HostRouteLinkRoutes,
  type HostRouteLinks,
  type UnresolvedHostRouteLink,
} from '@cardstack/runtime-common';

import {
  CardError,
  isGatewayFailureStatus,
} from '@cardstack/runtime-common/error';

import { duringPrerenderHeaders } from '@cardstack/host/lib/prerender-fetch-headers';

import type HostModeService from './host-mode-service';
import type NetworkService from './network';
import type RenderStoreService from './render-store';
import type SessionService from './session';
import type StoreService from './store';

import type { BaseDef, CardDef } from '@cardstack/base/card-api';

const log = logger('host-route-links');

// What an HTML visit read of its realm's routes. `routes` is `undefined`
// when the read got none. `key`
// says which read it was; see `routesReadKey`. `failure` is set when the
// read itself failed (the endpoint answered a server error, or the network
// failed). That is a failure to reach the routes, never a state of them: the
// endpoint always answers the whole tree the realm's last index stored.
interface RealmRoutes {
  key: string;
  routes: HostRouteLinkRoutes | undefined;
  failure?: CardError;
}

type RenderGlobals = {
  __boxelRenderContext?: boolean;
  __boxelConsumingRealm?: string;
  __boxelJobId?: string;
};

// Gives the links in card templates their URLs: what the `hrefTo` helper of
// the base realm calls. The helper is card code with no service to inject,
// so this service registers itself on the global the runtime declares
// (`getHostRouteLinks`).
//
// A link gets its routed address wherever the realm has routes, whether or
// not a host URL serves the realm (ADR 036 §1.7): the routed path is the
// same either way, and only the URL it is on differs, which the response
// boundary translates (ADR 033 §1.5). The routes come from:
//
// - On a page served on a host URL, the routes the realm server put in the
//   page's config.
// - In an HTML visit, the realm's routes endpoint. The stored HTML carries
//   the address on the realm's own URL.
//
// In the app (interact mode, code mode, host submode) there are no routes
// yet, and links keep card URLs: the app doesn't open a routed address on a
// workspace's URL.
//
// The endpoint serves routes the realm already validated, so nothing here
// validates them again. An HTML visit reads once for each indexing job.
// Until the read lands, and when it gets no routes, links fall back.
//
// One case fails the render instead: the read of the routes fails to reach
// them, because the endpoint answers a server error (a 5xx) or the network
// fails.
// That is a transport failure, not a state of the routes, which the realm
// always answers whole. The links would otherwise be stored with card URLs
// that nothing corrects later. The visit doesn't ask again: a transport
// failure seldom passes within one render, and the prerender runs a visit
// that failed this way again. The link throws an error marked as a gateway
// failure, so the HTML that is stored stays as it was and the visit is tried
// again.
export default class HostRouteLinksService
  extends Service
  implements HostRouteLinks
{
  @service declare private hostModeService: HostModeService;
  @service declare private network: NetworkService;
  @service('render-store') declare private renderStore: RenderStoreService;
  @service declare private session: SessionService;
  @service('store') declare private appStore: StoreService;

  // The cards a link asked the store for, by the id the link gave. `null`
  // for a card that could not be loaded, which is not asked for again. The
  // map is written only when a load settles, never during a render.
  private askedCards = new TrackedMap<string, CardDef | null>();
  private cardLoads = new Map<string, Promise<void>>();

  // The page config's routes as the lookup takes them, kept so that the
  // realm URL is parsed once.
  private pageRoutes:
    | { config: unknown; routes: HostRouteLinkRoutes | undefined }
    | undefined;

  // The routes an HTML visit read from each realm's endpoint, by realm URL.
  // Written only when a read settles, never during a render.
  private realmRoutes = new TrackedMap<string, RealmRoutes>();
  // The read under way for each realm. A read that settles after another
  // took its place is dropped.
  private routeReads = new Map<string, { key: string; read: number }>();
  private routeReadCount = 0;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    registerDestructor(this, registerHostRouteLinks(this));
  }

  resetState() {
    this.askedCards.clear();
    this.cardLoads.clear();
    this.pageRoutes = undefined;
    this.routeReads.clear();
    this.realmRoutes.clear();
  }

  // Whether this render is an HTML visit, not a render for a person looking
  // at the app.
  private get inHTMLVisit(): boolean {
    return (globalThis as RenderGlobals).__boxelRenderContext === true;
  }

  // The store the cards of this render live in.
  private get store(): StoreService {
    return this.inHTMLVisit ? this.renderStore : this.appStore;
  }

  link(
    target: HostRouteAddressTarget,
    api: Omit<CardAPIForMatching, 'virtualNetwork'>,
  ): string | undefined {
    return hostRouteLink(target, {
      routes: this.routes(),
      api: { ...api, virtualNetwork: this.network.virtualNetwork },
      loadedCard: this.loadedCard,
      unresolved: this.reportUnresolved,
    });
  }

  // The routes that give this render's links their addresses, or
  // `undefined` when its links keep card URLs.
  routes(): HostRouteLinkRoutes | undefined {
    let fromPage = this.routesFromPageConfig();
    if (fromPage || this.hostModeService.isActive) {
      // A page served on a host URL has its routes in its config, or the
      // realm has no dynamic route.
      return fromPage;
    }
    if (!this.inHTMLVisit) {
      // The app can't open a routed address.
      return undefined;
    }
    let realmURL = this.visitedRealmURL();
    return realmURL ? this.routesOfRealm(realmURL) : undefined;
  }

  // The URL of the realm of the card an HTML visit renders.
  private visitedRealmURL(): string | undefined {
    let realm = (globalThis as RenderGlobals).__boxelConsumingRealm;
    if (!realm) {
      return undefined;
    }
    try {
      return this.network.virtualNetwork.toURL(realm).href;
    } catch {
      return undefined;
    }
  }

  // Which read of a realm's routes an HTML visit needs: one for each
  // indexing job, and one for each visit that no job started.
  private routesReadKey(): string {
    return (
      (globalThis as RenderGlobals).__boxelJobId ??
      `visit:${globalThis.location?.pathname ?? ''}`
    );
  }

  private routesOfRealm(realmURL: string): HostRouteLinkRoutes | undefined {
    let key = this.routesReadKey();
    let held = this.realmRoutes.get(realmURL);
    if (held?.key === key) {
      if (held.failure) {
        throw held.failure;
      }
      return held.routes;
    }
    this.readRoutes(realmURL, key);
    // What another job or visit read may be out of date, and stored HTML
    // must not carry an address from it, so the visit waits for its own
    // read.
    return undefined;
  }

  // Reads the realm's routes, unless that read is already under way. The
  // read is tracked as a load of the render's store, so the HTML visit waits
  // for it before its HTML is stored.
  private readRoutes(realmURL: string, key: string): void {
    if (this.routeReads.get(realmURL)?.key === key) {
      return;
    }
    let read = ++this.routeReadCount;
    this.routeReads.set(realmURL, { key, read });
    this.store.trackLoad(this.fetchRoutes(realmURL, key, read));
  }

  private async fetchRoutes(
    realmURL: string,
    key: string,
    read: number,
  ): Promise<void> {
    // A link asks from inside a render, and the result is tracked state, so
    // everything here happens in a later microtask.
    await Promise.resolve();
    let routes: HostRouteLinkRoutes | undefined;
    let failure: CardError | undefined;
    let url = `${realmURL}_host-routes`;
    try {
      let response = await this.network.authedFetch(url, {
        headers: {
          Accept: 'application/json',
          // Tells the realm that a render waits on this request, so it must
          // not wait on a render itself.
          ...duringPrerenderHeaders(),
        },
      });
      let body = response.ok
        ? ((await response.json()) as { routes?: unknown })
        : undefined;
      if (Array.isArray(body?.routes)) {
        routes = {
          realmURL: new URL(realmURL),
          routes: body.routes as HostRoute[],
        };
      } else {
        // The endpoint failed (a transport failure), or this session can't
        // read the realm.
        log.debug(
          `no host routes from ${realmURL} for now (status ${response.status})`,
        );
        if (response.status >= 500 || isGatewayFailureStatus(response.status)) {
          failure = routesReadFailure(
            `the host routes of ${realmURL} could not be read: ${url} answered HTTP ${response.status}`,
            response.status,
          );
        }
      }
    } catch (e) {
      log.debug(`reading the host routes of ${realmURL} failed: ${String(e)}`);
      failure = routesReadFailure(
        `reading the host routes of ${realmURL} failed: ${String(e)}`,
        502,
      );
    }
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    if (this.routeReads.get(realmURL)?.read !== read) {
      // Another read took this one's place.
      return;
    }
    this.routeReads.delete(realmURL);
    this.realmRoutes.set(realmURL, {
      key,
      routes,
      ...(failure ? { failure } : {}),
    });
  }

  private routesFromPageConfig(): HostRouteLinkRoutes | undefined {
    let config = this.hostModeService.hostDynamicRoutes;
    let pageRoutes = this.pageRoutes;
    if (!pageRoutes || pageRoutes.config !== config) {
      pageRoutes = this.pageRoutes = {
        config,
        routes: config
          ? { realmURL: new URL(config.realmURL), routes: config.routes }
          : undefined,
      };
    }
    return pageRoutes.routes;
  }

  // The loaded card for an id a link gave. A card the store doesn't hold is
  // asked for through the store, which makes the HTML visit wait for it and
  // records it as a dependency of the render. The link reads this again when
  // the card arrives.
  private loadedCard = (id: string): BaseDef | undefined => {
    let held = this.store.peek(id);
    if (isCardInstance(held)) {
      return held;
    }
    let asked = this.askedCards.get(id);
    if (asked !== undefined) {
      return asked ?? undefined;
    }
    if (!this.cardLoads.has(id)) {
      let load = this.loadCard(id);
      this.cardLoads.set(id, load);
      this.store.trackLoad(load);
    }
    return undefined;
  };

  private async loadCard(id: string): Promise<void> {
    // A link asks from inside a render, and the store's load writes tracked
    // state, so the load starts in a later microtask.
    await Promise.resolve();
    let card: CardDef | null = null;
    try {
      let result = await this.store.get(id, {
        dependencyTrackingContext: runtimeNonQueryDependencyContext({
          source: 'host-route-links:loadCard',
        }),
      });
      card = isCardInstance(result) ? result : null;
    } catch (e) {
      log.debug(`could not load ${id} for a link: ${String(e)}`);
    }
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    this.cardLoads.delete(id);
    this.askedCards.set(id, card);
  }

  // The one place a link that got no routed address is reported. Nothing is
  // stored: a link reports again each time it renders.
  private reportUnresolved = (link: UnresolvedHostRouteLink): void => {
    log.debug(
      `a link to ${link.target} (${link.form}) has no routed address in ${
        link.realmURL
      }: ${link.reason}${link.routePath ? ` at ${link.routePath}` : ''}`,
    );
  };
}

// A read of a realm's routes that failed to reach them, as the error an HTML
// visit fails with. The gateway failure marker
// makes the prerender keep the card's stored HTML and try the visit again.
function routesReadFailure(message: string, status: number): CardError {
  let error = new CardError(message, { status });
  error.gatewayFailure = true;
  return error;
}

declare module '@ember/service' {
  interface Registry {
    'host-route-links': HostRouteLinksService;
  }
}
