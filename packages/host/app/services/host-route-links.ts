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

import type HostModeService from './host-mode-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';
import type RenderStoreService from './render-store';
import type SessionService from './session';
import type StoreService from './store';
import type { BaseDef, CardDef } from '@cardstack/base/card-api';

const log = logger('host-route-links');

// How long the app waits before it reads a realm's routes again after a
// read that got none: the endpoint answered 503 because a route's type
// can't be read yet, or the read failed.
const ROUTES_RETRY_MS = 5000;

// What was last read of a realm's routes. `routes` is `undefined` when the
// read got none. `key` says which read it was; see `routesReadKey`.
interface RealmRoutes {
  key: string;
  routes: HostRouteLinkRoutes | undefined;
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
// The routes are those of the realm the render is for:
//
// - On a page served on a host URL, the ones the realm server put in the
//   page's config.
// - In an HTML visit, those of the realm of the card the visit renders, read
//   from the realm's routes endpoint.
// - In the app (interact mode, code mode), those of the realm that is open,
//   read from the same endpoint.
//
// The endpoint serves routes the realm already validated, so nothing here
// validates them again. A realm's routes are read once, and again after the
// realm is indexed: the app hears of that from the realm's index events, and
// an HTML visit reads once for each indexing job. Until a read lands, and
// when it gets no routes, links fall back as in a realm with no routes.
export default class HostRouteLinksService
  extends Service
  implements HostRouteLinks
{
  @service declare private hostModeService: HostModeService;
  @service declare private messageService: MessageService;
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;
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

  // The routes read from each realm's endpoint, by realm URL. Written only
  // when a read settles, never during a render.
  private realmRoutes = new TrackedMap<string, RealmRoutes>();
  // The read under way for each realm. A read that settles after another
  // took its place is dropped.
  private routeReads = new Map<string, { key: string; read: number }>();
  private routeReadCount = 0;
  private routeRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private indexSubscriptions = new Map<string, () => void>();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    registerDestructor(this, registerHostRouteLinks(this));
    registerDestructor(this, () => this.forgetRealmRoutes());
  }

  resetState() {
    this.askedCards.clear();
    this.cardLoads.clear();
    this.pageRoutes = undefined;
    this.forgetRealmRoutes();
  }

  private forgetRealmRoutes() {
    for (let timer of this.routeRetries.values()) {
      clearTimeout(timer);
    }
    this.routeRetries.clear();
    for (let unsubscribe of this.indexSubscriptions.values()) {
      unsubscribe();
    }
    this.indexSubscriptions.clear();
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

  // The routes of the realm this render is for, or `undefined` when there
  // are none to read.
  routes(): HostRouteLinkRoutes | undefined {
    let fromPage = this.routesFromPageConfig();
    if (fromPage || this.hostModeService.isActive) {
      // A page served on a host URL has its routes in its config, or the
      // realm has no dynamic route.
      return fromPage;
    }
    let realmURL = this.renderedRealmURL();
    return realmURL ? this.routesOfRealm(realmURL) : undefined;
  }

  // The URL of the realm this render is for, when the page config doesn't
  // say: the realm of the card an HTML visit renders, or the realm that is
  // open in the app.
  private renderedRealmURL(): string | undefined {
    let realm = this.inHTMLVisit
      ? (globalThis as RenderGlobals).__boxelConsumingRealm
      : this.operatorModeStateService.realmURL;
    if (!realm) {
      return undefined;
    }
    try {
      return this.network.virtualNetwork.toURL(realm).href;
    } catch {
      return undefined;
    }
  }

  // Which read of a realm's routes this render needs. The app reads once
  // and then follows the realm's index events. An HTML visit has no such
  // events, so it reads once for each indexing job, and once for each visit
  // that no job started.
  private routesReadKey(): string {
    if (!this.inHTMLVisit) {
      return 'app';
    }
    return (
      (globalThis as RenderGlobals).__boxelJobId ??
      `visit:${globalThis.location?.pathname ?? ''}`
    );
  }

  private routesOfRealm(realmURL: string): HostRouteLinkRoutes | undefined {
    let key = this.routesReadKey();
    let held = this.realmRoutes.get(realmURL);
    if (held?.key === key) {
      return held.routes;
    }
    this.readRoutes(realmURL, key);
    // What another job or visit read may be out of date, and stored HTML
    // must not carry an address from it, so the visit waits for its own
    // read.
    return undefined;
  }

  // Reads the realm's routes, unless that read is already under way. The
  // read is tracked as a load of the render's store, so an HTML visit waits
  // for it before its HTML is stored.
  private readRoutes(realmURL: string, key: string): void {
    if (this.routeReads.get(realmURL)?.key === key) {
      return;
    }
    let read = ++this.routeReadCount;
    this.routeReads.set(realmURL, { key, read });
    this.store.trackLoad(this.fetchRoutes(realmURL, key, read));
    if (key === 'app' && !this.indexSubscriptions.has(realmURL)) {
      this.indexSubscriptions.set(
        realmURL,
        this.messageService.subscribe(realmURL, (event) => {
          if (
            event.eventName === 'index' &&
            (event.indexType === 'full' || event.indexType === 'incremental')
          ) {
            this.readRoutesAgain(realmURL);
          }
        }),
      );
    }
  }

  // Reads the app's copy of a realm's routes again. Links keep the routes
  // they have until the new ones land.
  private readRoutesAgain(realmURL: string): void {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    let retry = this.routeRetries.get(realmURL);
    if (retry !== undefined) {
      clearTimeout(retry);
      this.routeRetries.delete(realmURL);
    }
    // A read under way may have been answered before the realm changed.
    this.routeReads.delete(realmURL);
    this.readRoutes(realmURL, 'app');
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
    let gotNone = false;
    try {
      let response = await this.network.authedFetch(`${realmURL}_host-routes`, {
        headers: { Accept: 'application/json' },
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
        // 503 while a route's type can't be read yet, or a realm this
        // session can't read.
        gotNone = true;
        log.debug(
          `no host routes from ${realmURL} for now (status ${response.status})`,
        );
      }
    } catch (e) {
      gotNone = true;
      log.debug(`reading the host routes of ${realmURL} failed: ${String(e)}`);
    }
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    if (this.routeReads.get(realmURL)?.read !== read) {
      // Another read took this one's place.
      return;
    }
    this.routeReads.delete(realmURL);
    let held = this.realmRoutes.get(realmURL);
    if (gotNone && held?.key === key && held.routes) {
      // A read again that got none keeps the routes the app has.
    } else {
      this.realmRoutes.set(realmURL, { key, routes });
    }
    // The app tries again later. An HTML visit doesn't wait: the next job
    // or visit reads again.
    if (gotNone && key === 'app' && !this.routeRetries.has(realmURL)) {
      this.routeRetries.set(
        realmURL,
        setTimeout(() => {
          this.routeRetries.delete(realmURL);
          this.readRoutesAgain(realmURL);
        }, ROUTES_RETRY_MS),
      );
    }
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

declare module '@ember/service' {
  interface Registry {
    'host-route-links': HostRouteLinksService;
  }
}
