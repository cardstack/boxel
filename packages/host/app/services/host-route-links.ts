import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import {
  ensureTrailingSlash,
  hasExecutableExtension,
  hostRouteLink,
  isCardInstance,
  logger,
  registerHostRouteLinks,
  resolveHostRoute,
  runtimeNonQueryDependencyContext,
  type CardAPIForMatching,
  type HostRoute,
  type HostRouteErrorResult,
  type HostRouteAddressTarget,
  type HostRouteLinkRoutes,
  type HostRouteLinks,
  type UnresolvedHostRouteLink,
} from '@cardstack/runtime-common';

import { CardError } from '@cardstack/runtime-common/error';
import { scopedRenderContext } from '@cardstack/runtime-common/render-context';

import { currentRenderScope } from '@cardstack/host/lib/gc-card-store';
import { visitorHostRouteLookups } from '@cardstack/host/lib/host-route-lookups';
import { plainLinkClickURL } from '@cardstack/host/lib/link-clicks';
import { duringPrerenderHeaders } from '@cardstack/host/lib/prerender-fetch-headers';

import type HostModeService from './host-mode-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';
import type RenderStoreService from './render-store';
import type SessionService from './session';
import type StoreService from './store';

import type { BaseDef, CardDef } from '@cardstack/base/card-api';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

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
// - In interact mode and code mode, the routes endpoint of the realm
//   currently open (the workspace the stacks show, or the realm of the open
//   file). A click on a routed address opens its card in the app (see
//   `followRoutedLinks`). The app reads the routes when one of the two modes
//   shows, and again after each index of the realm that changes realm.json
//   or a module, so a change to the routes or to a route type reaches the
//   app. Until a first read lands, links keep card URLs.
//
// In host submode there are no routes, and links keep card URLs.
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

  // How many views that follow routed links are shown (interact mode, code
  // mode); see `followRoutedLinks`. Not tracked: `linkViewChanges` tells
  // the links when it changed.
  private linkViews = 0;
  @tracked private linkViewChanges = 0;
  // In such a view: the routes of the last read of a realm's endpoint that
  // got an answer. `undefined` routes: the realm has none. They stay in use
  // while the next read is under way, after it fails, and while no such
  // view shows, so links keep their addresses meanwhile.
  // Written only when a read settles, never during a render, and only when
  // the routes changed, so a read that finds the same routes renders no link
  // again.
  @tracked private appRoutes:
    | { realmURL: string; routes: HostRouteLinkRoutes | undefined }
    | undefined;
  // The realm whose routes the app reads while such a view shows: the
  // realm open there. `read` is the number of the read under way. A read
  // that settles after another took its place is dropped.
  private appRoutesWatch:
    | { realmURL: string; unsubscribe: () => void; read: number | undefined }
    | undefined;

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
    this.stopWatchingAppRoutes();
    this.appRoutes = undefined;
  }

  willDestroy() {
    this.stopWatchingAppRoutes();
    super.willDestroy();
  }

  // Called while a view of the open realm shows (interact mode, code
  // mode). Until the returned function is called, every link in the app
  // gets a routed address from the open realm's routes, and a plain click
  // on a link to a routed address, anywhere on `page`, opens the card the
  // address resolves to, with no page load, as a page load of the address
  // would serve it. The view says how, in `follower`.
  //
  // A redirect inside the realm is followed in the app. A lookup that fails
  // keeps the app where it is, and opens the card whose load failed when
  // there is one, which shows the failure. A redirect out of the realm and
  // an address no route serves go to the view's `load`. Any other click
  // keeps the browser's default: see `lib/link-clicks`.
  //
  // A click is dropped when another click follows it before its card is
  // known, when another realm was opened meanwhile, and when the view no
  // longer shows.
  followRoutedLinks(page: Document, follower: RoutedLinkFollower): () => void {
    let follows = 0;
    let shown = true;
    let follow = async (url: URL, open: (cardHref: string) => void) => {
      let mine = ++follows;
      let realm = this.operatorModeStateService.openRealmURL;
      let target = await this.followAddress(url);
      if (
        !target ||
        !shown ||
        mine !== follows ||
        this.isDestroying ||
        this.isDestroyed ||
        this.operatorModeStateService.openRealmURL !== realm
      ) {
        return;
      }
      if (target.kind === 'load') {
        follower.load(target.href);
      } else if (target.cardHref) {
        open(target.cardHref);
      }
    };
    let onClick = (event: MouseEvent) => {
      let url = plainLinkClickURL(event);
      if (!url || !this.holdsRoutesFor(url)) {
        return;
      }
      event.preventDefault();
      void follow(url, follower.opener(event));
    };
    page.addEventListener('click', onClick);
    this.linkViews++;
    this.noteLinkViewChange();
    return () => {
      if (shown) {
        shown = false;
        page.removeEventListener('click', onClick);
        this.linkViews--;
        this.noteLinkViewChange();
      }
    };
  }

  // The caller is a modifier, inside a render that links may have read in,
  // so the links render again in a later microtask. Once no view that
  // follows routed links shows, the app stops reading the routes, and it
  // reads them again when one shows again.
  private noteLinkViewChange() {
    void Promise.resolve().then(() => {
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      if (this.linkViews === 0) {
        this.stopWatchingAppRoutes();
      }
      this.linkViewChanges++;
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
      return this.openRealmRoutes();
    }
    if (scopedRenderContext()) {
      // This tab renders a card for its own index, and a link can't tell
      // whether it renders for that or for someone looking at the app. It
      // takes the visit's routes, and also reads the app's, so that a link
      // in the app renders again once they change.
      void this.openRealmRoutes();
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

  // While a view that follows routed links shows, the routes of the realm
  // currently open, or `undefined` while they are read. `undefined` when no
  // such view shows.
  private openRealmRoutes(): HostRouteLinkRoutes | undefined {
    void this.linkViewChanges;
    let realmURL = this.openRealmURL();
    if (!realmURL) {
      return undefined;
    }
    if (this.appRoutesWatch?.realmURL !== realmURL) {
      this.watchAppRoutes(realmURL);
    }
    let held = this.appRoutes;
    return held?.realmURL === realmURL ? held.routes : undefined;
  }

  // While a view that follows routed links shows, the URL of the realm
  // open there.
  private openRealmURL(): string | undefined {
    if (this.linkViews === 0) {
      return undefined;
    }
    let realm = this.operatorModeStateService.openRealmURL;
    if (!realm) {
      return undefined;
    }
    try {
      return ensureTrailingSlash(this.network.virtualNetwork.toURL(realm).href);
    } catch {
      return undefined;
    }
  }

  // Reads a realm's routes for the app, in place of the realm read so far,
  // and listens for the realm's indexes, after each one that may have
  // changed them it reads them again.
  private watchAppRoutes(realmURL: string): void {
    this.stopWatchingAppRoutes();
    let unsubscribe = this.messageService.subscribe(realmURL, (event) => {
      if (
        this.appRoutesWatch?.realmURL === realmURL &&
        routesMayHaveChanged(realmURL, event)
      ) {
        this.readAppRoutes();
      }
    });
    this.appRoutesWatch = { realmURL, unsubscribe, read: undefined };
    this.readAppRoutes();
  }

  private stopWatchingAppRoutes(): void {
    this.appRoutesWatch?.unsubscribe();
    this.appRoutesWatch = undefined;
  }

  // Reads the watched realm's routes, in place of a read under way.
  private readAppRoutes(): void {
    let watch = this.appRoutesWatch;
    if (!watch) {
      return;
    }
    let read = ++this.routeReadCount;
    watch.read = read;
    void this.fetchAppRoutes(watch.realmURL, read);
  }

  private async fetchAppRoutes(realmURL: string, read: number): Promise<void> {
    // A link asks from inside a render, and the result is tracked state, so
    // everything here happens in a later microtask.
    await Promise.resolve();
    let result = await this.requestRoutes(realmURL);
    let watch = this.appRoutesWatch;
    if (
      this.isDestroying ||
      this.isDestroyed ||
      watch?.realmURL !== realmURL ||
      watch.read !== read
    ) {
      return;
    }
    watch.read = undefined;
    if ('failure' in result) {
      // The routes held so far stay in use. The app reads them again after
      // the realm's next index that may change them, and when a view that
      // follows routed links shows again.
      return;
    }
    let held = this.appRoutes;
    if (held?.realmURL === realmURL && sameRoutes(held.routes, result.routes)) {
      return;
    }
    this.appRoutes = { realmURL, routes: result.routes };
  }

  // What a click on a routed address does in the app, worked out
  // with the same resolver and lookups a page load of the address runs, as
  // the signed-in user (ADR 036 §1.4). Only for an address in the open
  // realm, whose routes the app holds; see `holdsRoutesFor`. `undefined`
  // when they are no longer held.
  //
  // A redirect inside the realm is resolved here too, at most
  // `MAX_REDIRECT_HOPS` times, so that a realm with no host URL, whose
  // server doesn't resolve routes, never gets the address. A redirect out
  // of the realm is the browser's to load, and so is an address no route
  // serves.
  async followAddress(url: URL): Promise<RoutedAddressFollow | undefined> {
    let routes = this.heldRoutesFor(url);
    if (!routes) {
      return undefined;
    }
    let address = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      let resolution = await resolveHostRoute({
        path: `/${address.pathname.slice(routes.realmURL.pathname.length)}`,
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
          return { kind: 'card', cardHref: resolution.cardHref };
        case 'nothing':
          return { kind: 'load', href: address.href };
        case 'error':
          log.warn(
            `host route lookup for ${address.href} failed: ${String(
              resolution.error,
            )}`,
          );
          return { kind: 'failed', cardHref: failedLoadHref(resolution) };
        case 'redirect': {
          let target = resolution.external
            ? new URL(resolution.location)
            : new URL(resolution.location.slice(1), routes.realmURL);
          if (
            target.origin !== routes.realmURL.origin ||
            !target.pathname.startsWith(routes.realmURL.pathname) ||
            target.search ||
            target.hash
          ) {
            return { kind: 'load', href: target.href };
          }
          address = target;
          break;
        }
      }
    }
    log.warn(
      `host route redirects from ${url.href} go on past ${MAX_REDIRECT_HOPS} hops`,
    );
    return { kind: 'failed', cardHref: undefined };
  }

  // Whether a URL is in the realm open in the app, whose routes the
  // app holds, and that has any: a URL a click may follow with
  // `followAddress`.
  holdsRoutesFor(url: URL): boolean {
    return this.heldRoutesFor(url) !== undefined;
  }

  private heldRoutesFor(url: URL): HostRouteLinkRoutes | undefined {
    let held = this.appRoutes;
    let routes = held?.routes;
    if (
      !routes ||
      held?.realmURL !== this.openRealmURL() ||
      routes.routes.length === 0 ||
      url.origin !== routes.realmURL.origin ||
      !url.pathname.startsWith(routes.realmURL.pathname)
    ) {
      return undefined;
    }
    return routes;
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

// How a view opens what a click on a routed address leads to; see
// `followRoutedLinks`.
export interface RoutedLinkFollower {
  // Called at the click. Returns what opens the card once the address has
  // resolved, so the view can note where the click happened.
  opener(event: MouseEvent): (cardHref: string) => void;
  // Has the browser load a URL the app can't show.
  load(href: string): void;
}

// How many redirects a click on a routed address follows in the app.
const MAX_REDIRECT_HOPS = 5;

// What a click on a routed address does in the app.
export type RoutedAddressFollow =
  // Open this card.
  | { kind: 'card'; cardHref: string }
  // Leave the app: the browser loads this URL.
  | { kind: 'load'; href: string }
  // A lookup failed. `cardHref` is the card whose load failed, when the
  // failed lookup was the load of one card.
  | { kind: 'failed'; cardHref: string | undefined };

// The card whose load made a resolution fail, when the failed lookup was a
// load of one card, not a search.
function failedLoadHref(resolution: HostRouteErrorResult): string | undefined {
  let step = resolution.trace[resolution.trace.length - 1];
  return step?.outcome === 'error' && step.lookup?.kind === 'load'
    ? step.lookup.cardHref
    : undefined;
}

// Whether a realm event may have changed the routes the realm's endpoint
// serves. The stored tree changes only in an index that changes realm.json
// or a module (ADR 036 §1.5). A full index, and an incremental one too
// large to list what it changed, may have changed either.
function routesMayHaveChanged(
  realmURL: string,
  event: RealmEventContent,
): boolean {
  if (event.eventName !== 'index') {
    return false;
  }
  if (event.indexType === 'full') {
    return true;
  }
  if (event.indexType !== 'incremental') {
    return false;
  }
  if ('realmWide' in event) {
    return true;
  }
  return event.invalidations.some(
    (url) =>
      url === `${realmURL}realm` ||
      url === `${realmURL}realm.json` ||
      hasExecutableExtension(url),
  );
}

function sameRoutes(
  a: HostRouteLinkRoutes | undefined,
  b: HostRouteLinkRoutes | undefined,
): boolean {
  return (
    a?.realmURL.href === b?.realmURL.href &&
    JSON.stringify(a?.routes) === JSON.stringify(b?.routes)
  );
}

declare module '@ember/service' {
  interface Registry {
    'host-route-links': HostRouteLinksService;
  }
}
