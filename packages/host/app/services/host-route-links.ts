import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import {
  ensureTrailingSlash,
  hostRouteLink,
  isCardInstance,
  logger,
  registerHostRouteLinks,
  resolveHostRoute,
  runtimeNonQueryDependencyContext,
  type CardAPIForMatching,
  type HostRoute,
  type HostRouteAddressTarget,
  type HostRouteLinkRoutes,
  type HostRouteLinks,
  type UnresolvedHostRouteLink,
} from '@cardstack/runtime-common';

import { CardError } from '@cardstack/runtime-common/error';
import { scopedRenderContext } from '@cardstack/runtime-common/render-context';

import { currentRenderScope } from '@cardstack/host/lib/gc-card-store';
import { visitorHostRouteLookups } from '@cardstack/host/lib/host-route-lookups';
import { duringPrerenderHeaders } from '@cardstack/host/lib/prerender-fetch-headers';

import type HostModeService from './host-mode-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';
import type RenderStoreService from './render-store';
import type SessionService from './session';
import type StoreService from './store';

import type { BaseDef, CardDef } from '@cardstack/base/card-api';

const log = logger('host-route-links');

// What an HTML visit read of its realm's routes. `routes` is `undefined`
// when the endpoint answered that the realm has none for this reader (a
// 404). `key` says which read it was; see `routesReadKey`. Only an answer is
// kept: a read that failed is not.
interface RealmRoutes {
  key: string;
  routes: HostRouteLinkRoutes | undefined;
}

// What one request to a realm's routes endpoint got: the routes (`undefined`
// for a 404, no routes), or the failure to read them.
type RoutesRead =
  | { routes: HostRouteLinkRoutes | undefined }
  | { failure: CardError };

// The cards links asked the store for, for one store identity in one render
// scope; see `scopedCards`.
interface AskedCards {
  scope: string;
  // By the id the link gave. `null` for a card that could not be loaded,
  // which is not asked for again in this scope.
  cards: TrackedMap<string, CardDef | null>;
  loads: Map<string, Promise<void>>;
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
// - In interact mode, the routes endpoint of the realm currently open (the
//   workspace the stacks show). A click on a routed address opens its card
//   in the stack (see `cardAtAddress`). The app reads a realm's routes once,
//   and again each time an index of the realm finishes, so a change to
//   realm.json or to a route type reaches the app. Until a read lands, and
//   when it fails, links keep card URLs.
//
// In code mode and host submode there are no routes, and links keep card
// URLs.
//
// The endpoint serves the routes the realm's last index validated and
// stored, so nothing here validates them again. That tree can lack routes
// the realm's next index restores, and nothing runs the HTML visits that
// read it again then (the ADR 036 remediation file lists this). An HTML
// visit reads once for each indexing job, and waits for the read. Only two
// answers are kept for the job: a 200, which is the routes, and a 404, which
// is no routes, so links fall back.
//
// Any other answer fails the render instead: a server error, a timeout, a
// rate limit, a refusal (401, 403), or a network failure. It is a failure
// to read the routes, never a state of them, and the links would otherwise
// be stored with card URLs that nothing corrects later. The first link that
// asks after the failure lands throws an error marked as a gateway failure,
// so the HTML that is stored stays as it was and the prerender runs the
// visit again. The failure is then forgotten, so the next visit, or the
// visit's retry, reads the routes again.
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

  // The cards links asked the store for. Kept only as long as the store
  // keeps its cards: a new render scope or a store reset drops them, so a
  // link never reads a card's fields from a scope the store left, and the
  // card is asked for again, which records it as a dependency of the render
  // that asks. A card map is written only when a load settles, never during
  // a render; a new scope replaces the whole record.
  private askedCards: AskedCards | undefined;

  // The page config's routes as the lookup takes them, kept so that the
  // realm URL is parsed once.
  private pageRoutes:
    | { config: unknown; routes: HostRouteLinkRoutes | undefined }
    | undefined;

  // The routes an HTML visit read from each realm's endpoint, by realm URL.
  // Written only when a read settles, never during a render.
  private realmRoutes = new TrackedMap<string, RealmRoutes>();
  // A read of a realm's routes that failed, until a link throws it.
  // `routeFailureCount` changes when one lands, so the links that wait for
  // the read render again. The map itself is not tracked, so the link that
  // throws a failure can forget it during the render.
  private routeFailures = new Map<string, CardError>();
  @tracked private routeFailureCount = 0;
  // The read under way for each realm. A read that settles after another
  // took its place is dropped.
  private routeReads = new Map<
    string,
    { key: string; read: number; promise: Promise<void> }
  >();
  private routeReadCount = 0;

  // On a page served on a host URL: the card each routed address was made
  // for, by address, for the links rendered since `forgetLinkedCards` was
  // last called. A click uses it only to tell a routed address whose last
  // segment looks like a file name from a file; the address itself opens
  // the card the routes resolve it to. Not tracked: nothing renders from it.
  //
  // When Host Mode v2 lands, store the key as the address on the host URL
  // the page is served on. A click looks the key up by the link's URL on
  // the page. Until then a site is served at its realm's URL, so the address
  // `hrefTo` wrote, on the realm's URL, matches it.
  private linkedCards = new Map<string, string>();

  // How many interact mode views are shown; see `showInteractMode`. Not
  // tracked: `interactModeChanges` tells the links when it changed.
  private interactModeViews = 0;
  @tracked private interactModeChanges = 0;
  // In interact mode: the routes the app read from each realm's endpoint,
  // by realm URL. `undefined` routes: the realm has none, or the first read
  // failed. Written only when a read settles, never during a render.
  private appRoutes = new TrackedMap<
    string,
    { routes: HostRouteLinkRoutes | undefined }
  >();
  // The read under way for each realm, by number. A read that settles after
  // another took its place is dropped.
  private appRouteReads = new Map<string, number>();
  // The realm event subscription of each realm the app read routes from.
  private appRouteSubscriptions = new Map<string, () => void>();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    registerDestructor(this, registerHostRouteLinks(this));
  }

  resetState() {
    this.askedCards = undefined;
    this.pageRoutes = undefined;
    this.linkedCards.clear();
    this.routeReads.clear();
    this.realmRoutes.clear();
    this.routeFailures.clear();
    this.forgetAppRoutes();
  }

  willDestroy() {
    this.forgetAppRoutes();
    super.willDestroy();
  }

  private forgetAppRoutes() {
    for (let unsubscribe of this.appRouteSubscriptions.values()) {
      unsubscribe();
    }
    this.appRouteSubscriptions.clear();
    this.appRouteReads.clear();
    this.appRoutes.clear();
  }

  // Called while interact mode shows, so that links get routed addresses
  // from the open realm's routes. Returns the function to call when it no
  // longer shows.
  showInteractMode(): () => void {
    this.interactModeViews++;
    this.noteInteractModeChange();
    let shown = true;
    return () => {
      if (shown) {
        shown = false;
        this.interactModeViews--;
        this.noteInteractModeChange();
      }
    };
  }

  // The caller is a modifier, inside a render that links may have read in,
  // so the links render again in a later microtask.
  private noteInteractModeChange() {
    void Promise.resolve().then(() => {
      if (!this.isDestroying && !this.isDestroyed) {
        this.interactModeChanges++;
      }
    });
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
    let href = hostRouteLink(target, {
      routes: this.routes(),
      api: { ...api, virtualNetwork: this.network.virtualNetwork },
      loadedCard: this.loadedCard,
      unresolved: this.reportUnresolved,
    });
    this.rememberLinkedCard(target, href);
    return href;
  }

  // The URL of the card a routed address on this page was made for, or
  // `undefined` for an address no link rendered here was given.
  linkedCard(href: string): string | undefined {
    return this.linkedCards.get(href);
  }

  // Forgets the cards of the links rendered so far. Called once the visitor
  // has left a page, so only the links of the page the visitor is on count.
  forgetLinkedCards(): void {
    this.linkedCards.clear();
  }

  // Keeps the card a link's routed address was made for: the last card
  // given, which is the one the address serves. Only for a visitor's page on
  // a host URL, where a click can use it, and only for an address a route
  // gave: a card's own URL is resolved like any other path, because a route
  // may serve another card there.
  private rememberLinkedCard(
    target: HostRouteAddressTarget,
    href: string | undefined,
  ): void {
    if (
      !href ||
      target.kind !== 'cards' ||
      this.inHTMLVisit ||
      !this.hostModeService.isActive
    ) {
      return;
    }
    let card = target.cards[target.cards.length - 1];
    let id =
      typeof card === 'string' ? card : (card as CardDef | undefined)?.id;
    if (typeof id !== 'string' || !id) {
      return;
    }
    // Both as the browser writes them, which is how a click reads a link's
    // address.
    let cardURL: string;
    let address: string;
    try {
      cardURL = this.network.virtualNetwork.toURL(id).href;
      address = new URL(href).href;
    } catch {
      return;
    }
    if (cardURL !== address) {
      this.linkedCards.set(address, cardURL);
    }
  }

  // The routes that give this render's links their addresses, or
  // `undefined` when its links keep card URLs.
  routes(): HostRouteLinkRoutes | undefined {
    let fromPage = this.routesFromPageConfig();
    if (fromPage || this.hostModeService.isActive) {
      // A page served on a host URL has its routes in its config, or the
      // realm has no routes.
      return fromPage;
    }
    if (!this.inHTMLVisit) {
      return this.interactModeRoutes();
    }
    if (scopedRenderContext()) {
      // This tab renders a card for its own index, and a link can't tell
      // whether it renders for that or for someone looking at the app. It
      // takes the visit's routes, and also reads the app's, so that a link
      // in the app renders again once they change.
      void this.interactModeRoutes();
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
      return held.routes;
    }
    // Read so that the link renders again when a failure lands.
    void this.routeFailureCount;
    let failure = this.routeFailures.get(realmURL);
    if (failure) {
      this.routeFailures.delete(realmURL);
      throw failure;
    }
    this.readRoutes(realmURL, key);
    // What another job or visit read may be out of date, and stored HTML
    // must not carry an address from it, so the visit waits for its own
    // read.
    return undefined;
  }

  // Reads the realm's routes, unless that read is already under way. The
  // read is tracked as a load of the render's store, so the HTML visit waits
  // for it before its HTML is stored. A visit that finds the read under way
  // waits for it too.
  private readRoutes(realmURL: string, key: string): void {
    let inFlight = this.routeReads.get(realmURL);
    if (inFlight?.key === key) {
      this.store.trackLoad(inFlight.promise);
      return;
    }
    let read = ++this.routeReadCount;
    let promise = this.fetchRoutes(realmURL, key, read);
    this.routeReads.set(realmURL, { key, read, promise });
    this.store.trackLoad(promise);
  }

  private async fetchRoutes(
    realmURL: string,
    key: string,
    read: number,
  ): Promise<void> {
    // A link asks from inside a render, and the result is tracked state, so
    // everything here happens in a later microtask.
    await Promise.resolve();
    let result = await this.requestRoutes(realmURL);
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    if (this.routeReads.get(realmURL)?.read !== read) {
      // Another read took this one's place.
      return;
    }
    this.routeReads.delete(realmURL);
    if ('failure' in result) {
      this.routeFailures.set(realmURL, result.failure);
      this.routeFailureCount++;
      return;
    }
    this.routeFailures.delete(realmURL);
    this.realmRoutes.set(realmURL, { key, routes: result.routes });
  }

  // One request to a realm's routes endpoint. Only a 200 (the routes) and a
  // 404 (no routes) are answers; anything else is a failure to read them.
  private async requestRoutes(realmURL: string): Promise<RoutesRead> {
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
      if (response.status === 200) {
        let body = (await response.json()) as { routes?: unknown };
        if (!Array.isArray(body?.routes)) {
          throw new Error(`${url} answered 200 with no routes`);
        }
        return {
          routes: {
            realmURL: new URL(realmURL),
            routes: body.routes as HostRoute[],
          },
        };
      }
      if (response.status === 404) {
        // The realm serves no routes endpoint: no routes, so links fall back.
        log.debug(`no host routes from ${realmURL}: ${url} answered 404`);
        return { routes: undefined };
      }
      let message = `the host routes of ${realmURL} could not be read: ${url} answered HTTP ${response.status}`;
      log.debug(message);
      return { failure: routesReadFailure(message, response.status) };
    } catch (e) {
      log.debug(`reading the host routes of ${realmURL} failed: ${String(e)}`);
      return {
        failure: routesReadFailure(
          `reading the host routes of ${realmURL} failed: ${String(e)}`,
          502,
        ),
      };
    }
  }

  // In interact mode, the routes of the realm currently open, or
  // `undefined` while they are read, and outside interact mode.
  private interactModeRoutes(): HostRouteLinkRoutes | undefined {
    void this.interactModeChanges;
    if (this.interactModeViews === 0) {
      return undefined;
    }
    let realm = this.operatorModeStateService.openRealmURL;
    if (!realm) {
      return undefined;
    }
    let realmURL: string;
    try {
      realmURL = ensureTrailingSlash(
        this.network.virtualNetwork.toURL(realm).href,
      );
    } catch {
      return undefined;
    }
    let held = this.appRoutes.get(realmURL);
    if (held) {
      return held.routes;
    }
    this.readAppRoutes(realmURL);
    return undefined;
  }

  // Reads a realm's routes for the app, unless a read is already under way,
  // and listens for the realm's indexes, after each of which it reads them
  // again. The routes held so far stay in use while a read is under way,
  // and when it fails.
  private readAppRoutes(realmURL: string): void {
    if (!this.appRouteSubscriptions.has(realmURL)) {
      this.appRouteSubscriptions.set(
        realmURL,
        this.messageService.subscribe(realmURL, (event) => {
          if (
            event.eventName === 'index' &&
            (event.indexType === 'incremental' || event.indexType === 'full')
          ) {
            this.appRouteReads.delete(realmURL);
            this.readAppRoutes(realmURL);
          }
        }),
      );
    }
    if (this.appRouteReads.has(realmURL)) {
      return;
    }
    let read = ++this.routeReadCount;
    this.appRouteReads.set(realmURL, read);
    void this.fetchAppRoutes(realmURL, read);
  }

  private async fetchAppRoutes(realmURL: string, read: number): Promise<void> {
    // A link asks from inside a render, and the result is tracked state, so
    // everything here happens in a later microtask.
    await Promise.resolve();
    let result = await this.requestRoutes(realmURL);
    if (
      this.isDestroying ||
      this.isDestroyed ||
      this.appRouteReads.get(realmURL) !== read
    ) {
      return;
    }
    this.appRouteReads.delete(realmURL);
    if ('failure' in result) {
      // Read again after the realm's next index.
      if (!this.appRoutes.has(realmURL)) {
        this.appRoutes.set(realmURL, { routes: undefined });
      }
      return;
    }
    this.appRoutes.set(realmURL, { routes: result.routes });
  }

  // In interact mode, the card a routed address opens: the card the routes
  // of the realm it is in resolve it to, with the same resolver and lookups
  // a page load of the address runs, as the signed-in user (ADR 036 §1.4).
  // Only for an address in a realm whose routes the app holds; see
  // `holdsRoutesFor`. `undefined` when the address resolves to no card,
  // such as a redirect, a path no route serves, or a lookup that failed.
  async cardAtAddress(url: URL): Promise<string | undefined> {
    let routes = this.heldRoutesFor(url);
    if (!routes) {
      return undefined;
    }
    let resolution = await resolveHostRoute({
      path: `/${url.pathname.slice(routes.realmURL.pathname.length)}`,
      routes: routes.routes,
      realmURL: routes.realmURL,
      ...visitorHostRouteLookups({
        fetch: this.network.authedFetch,
        virtualNetwork: this.network.virtualNetwork,
        realmURL: routes.realmURL.href,
      }),
    });
    switch (resolution.kind) {
      // An alias serves its card for now, as in host mode.
      case 'card':
      case 'alias':
        return resolution.cardHref;
      case 'error':
        log.debug(
          `host route lookup for ${url.href} failed: ${String(
            resolution.error,
          )}`,
        );
        return undefined;
      default:
        return undefined;
    }
  }

  // Whether a URL is in a realm whose routes the app holds in interact
  // mode, and that has any: a URL a click may resolve with `cardAtAddress`.
  holdsRoutesFor(url: URL): boolean {
    return this.heldRoutesFor(url) !== undefined;
  }

  private heldRoutesFor(url: URL): HostRouteLinkRoutes | undefined {
    if (this.interactModeViews === 0) {
      return undefined;
    }
    for (let { routes } of this.appRoutes.values()) {
      if (
        routes &&
        routes.routes.length > 0 &&
        url.origin === routes.realmURL.origin &&
        url.pathname.startsWith(routes.realmURL.pathname)
      ) {
        return routes;
      }
    }
    return undefined;
  }

  // When Host Mode v2 lands, give the addresses on the host URL the page is
  // served on, and keep matching a card to its realm by the realm's URL.
  // Until then a site is served at its realm's URL, so these routes give
  // addresses on the realm's URL.
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
    let asked = this.scopedCards();
    let card = asked.cards.get(id);
    if (card !== undefined) {
      return card ?? undefined;
    }
    if (!asked.loads.has(id)) {
      let load = this.loadCard(id, asked);
      asked.loads.set(id, load);
      this.store.trackLoad(load);
    }
    return undefined;
  };

  // The cards asked for in the store's current identity and render scope:
  // a new, empty record when either moved since the last ask.
  private scopedCards(): AskedCards {
    let renderScope = this.inHTMLVisit
      ? (currentRenderScope() ?? 'visit')
      : 'app';
    let scope = `${renderScope}#${this.store.identityEpoch}`;
    if (this.askedCards?.scope !== scope) {
      this.askedCards = { scope, cards: new TrackedMap(), loads: new Map() };
    }
    return this.askedCards;
  }

  private async loadCard(id: string, asked: AskedCards): Promise<void> {
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
    // A load that settles after its scope ended goes into that scope's
    // record, which nothing reads any more.
    asked.loads.delete(id);
    asked.cards.set(id, card);
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
