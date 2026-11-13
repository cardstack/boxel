import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import window from 'ember-window-mock';

import {
  ensureTrailingSlash,
  isExternalRedirectTarget,
  logger,
  type RealmIdentifier,
  normalizeRoutingPath,
  resolveHostRoute,
  resolveRedirectTarget,
  sanitizeHeadHTML,
  type HostRoute,
  type HostRoutingRule,
} from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';

import config from '@cardstack/host/config/environment';
import { visitorHostRouteLookups } from '@cardstack/host/lib/host-route-lookups';

const log = logger('host-mode-service');

const DEFAULT_HEAD_HTML = '<title>Boxel</title>';

function headContainsTitle(html: string): boolean {
  return /<title[\s>]/.test(html);
}

function ensureSingleTitle(headHTML: string): string {
  return headContainsTitle(headHTML)
    ? headHTML
    : `${DEFAULT_HEAD_HTML}\n${headHTML}`;
}

import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type SessionService from '@cardstack/host/services/session';

// The routing realm's validated routes, the whole tree, as the realm server
// injects them next to the fixed routing map, for a realm with dynamic
// routes. `realmURL` is the URL the realm is served at, ending with `/`.
// `complete` is false when validation dropped routes for now because a type
// definition could not be read; the route set is then not final, so a path
// it does not resolve may still be one a route serves.
export interface HostDynamicRoutes {
  realmURL: string;
  routes: readonly HostRoute[];
  complete?: boolean;
}

// What a path no fixed rule matches resolves to through the dynamic routes.
// `card` serves the card at `cardHref`; `redirect` navigates to
// `redirectTo`, which is host-scoped like a fixed redirect rule's target;
// `error` is a lookup that failed or was refused. `unavailable` is a path a
// route matched but that resolved to nothing while the route set is
// incomplete: when the path is not a card's own path, a route dropped for
// now might serve it, so it is an error, not a missing page.
export type DynamicRoutedPath =
  | { kind: 'card'; cardHref: string }
  | { kind: 'redirect'; redirectTo: string }
  | { kind: 'error'; error: unknown }
  | { kind: 'unavailable' };

interface PublishedRealmMetadata {
  urlString: string;
  publishedAt: number;
  currentCardUrlString: string | undefined;
}

export default class HostModeService extends Service {
  @service declare hostModeStateService: HostModeStateService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare session: SessionService;
  @service declare private network: NetworkService;

  // The path the dynamic routes last resolved to a card, by canonical path,
  // so a change to the stack, which refreshes the route on the same page,
  // runs no lookup again. Only the current page is kept: a visitor who
  // moves to another path, or comes back to this one, gets a fresh lookup,
  // so a slug or route the author changed is never served from memory.
  private currentDynamicRoutedPath:
    | { path: string; result: DynamicRoutedPath }
    | undefined;

  // increasing token to ignore stale async head fetches
  private headUpdateRequestId = 0;

  // tracks whether the current head template contains a title tag
  @tracked headTemplateContainsTitle = false;

  // The workspace host mode's publish dialog is open for. Kept here rather
  // than in host mode itself, so the dashboard can open host mode with it
  // already open; host mode shows it only for that workspace.
  @tracked publishDialogRealm: string | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.headUpdateRequestId = 0;
    this.headTemplateContainsTitle = false;
    this.publishDialogRealm = undefined;
    this.currentDynamicRoutedPath = undefined;
    // A Publish still opening its workspace doesn't carry into the next
    // session.
    this.openToPublishTask.cancelAll();
  }

  // Opens the workspace in host mode, on its index card, with the publish
  // dialog open: where the dashboard's Publish actions lead. A second click
  // while the first is still opening the workspace is ignored.
  openToPublishTask = dropTask(async (realm: RealmIdentifier) => {
    let realmURL = this.network.virtualNetwork.toURL(realm).href;
    let operatorModeState = this.operatorModeStateService;
    try {
      await operatorModeState.openWorkspace(realmURL);
    } catch (error) {
      log.error(`opening ${realmURL} to publish failed`, error);
      return;
    }
    operatorModeState.setHostModePrimaryCard(
      `${ensureTrailingSlash(realmURL)}index`,
    );
    operatorModeState.updateSubmode(Submodes.Host);
    // Host mode's own realm URL, which is what it compares this to.
    this.publishDialogRealm = ensureTrailingSlash(this.realmURL);
  });

  // `index.html`'s boot script makes the same decision before the app loads,
  // to paint the app's boot and leave a published realm's page plain. A change
  // here is made there too.
  get isActive() {
    if (this.simulatingHostMode) {
      return true;
    }

    return (
      !config.hostsOwnAssets &&
      this.isRealmServerDomain === false &&
      this.originIsNotMatrixTests
    );
  }

  get isRealmServerDomain() {
    if (this.simulatingHostMode) {
      return false;
    }

    if (config.realmServerURL) {
      let realmServerDomain = new URL(config.realmServerURL).hostname;
      let currentHost = window.location.hostname;

      return (
        currentHost.endsWith(realmServerDomain) &&
        // Using a submdomain of localhost indicates host mode
        !currentHost.endsWith('.localhost')
      );
    }

    return false;
  }

  get simulatingHostMode() {
    return new URLSearchParams(window.location.search).has('hostModeOrigin');
  }

  get hostModeOrigin() {
    if (this.simulatingHostMode) {
      return new URLSearchParams(window.location.search).get('hostModeOrigin');
    }

    return window.location.origin;
  }

  get originIsNotMatrixTests() {
    // Realm-server speaks https locally now (see infra:ensure-dev-cert);
    // test-realms and the matrix-test realm share the same cert and
    // bind their respective ports.
    return (
      this.hostModeOrigin !== 'http://localhost:4202' &&
      this.hostModeOrigin !== 'https://localhost:4202' &&
      this.hostModeOrigin !== 'http://localhost:4205' &&
      this.hostModeOrigin !== 'https://localhost:4205'
    );
  }

  get realmURL() {
    return this.operatorModeStateService.realmURL;
  }

  // CS-10055: routing rules from the realm config card. The realm-server
  // merges this into the @cardstack/host/config/environment meta tag
  // per-request when the request hits a realm whose config card has
  // hostRoutingRules — so the first-render decision in the index route
  // is synchronous and the field is part of the typed config surface
  // rather than a window global. The rules arrive host-scoped — every
  // path, and any realm-relative redirect target, already carries the
  // realm's mount pathname — so a target can go straight to a location
  // change without the SPA knowing where the realm is mounted.
  get hostRoutingMap(): HostRoutingRule[] {
    let map = (config as { hostRoutingMap?: unknown }).hostRoutingMap;
    return Array.isArray(map) ? (map as HostRoutingRule[]) : [];
  }

  // Returns the routing rule matching `path`, else null. A serve rule
  // carries the target card `id` to render; a redirect rule carries the
  // `redirectTo` target the SPA should navigate to instead of rendering
  // anything (see `redirectTo` below).
  // `path` is the URL pathname on the host (what Ember's `/*path` catch-all
  // route delivers — e.g. `<user>/<realm>/whitepaper` for a request to
  // `https://host/<user>/<realm>/whitepaper`); a leading slash is added if
  // absent so the index path is matchable as either '' or '/'. The
  // server prefixes each rule's `path` with the realm's mount pathname
  // before injecting the map, so the two sides line up as direct equality
  // — except for the trailing-slash variance at the realm root. A `/`
  // rule's injected key is the realm's mount pathname WITH trailing
  // slash (e.g. `/progressive-cheetah/`), but Ember's catch-all strips
  // it (`params.path === 'progressive-cheetah'` for either visit form).
  // Canonicalize both sides with the shared `normalizeRoutingPath` (strips
  // trailing slashes, preserves the root `/`) before comparing, so
  // `/realm` ↔ `/realm/` resolve and the client agrees with how the server
  // map builder and the editor normalize.
  resolveRoutedPath(path: string): HostRoutingRule | null {
    let normalized = path.startsWith('/') ? path : `/${path}`;
    let canonical = normalizeRoutingPath(normalized);
    let rule = this.hostRoutingMap.find(
      (r) => normalizeRoutingPath(r.path) === canonical,
    );
    return rule ?? null;
  }

  // The routing realm's routes, when it has dynamic routes; see
  // `HostDynamicRoutes`.
  get hostDynamicRoutes(): HostDynamicRoutes | undefined {
    let value = (config as { hostDynamicRoutes?: unknown }).hostDynamicRoutes;
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as HostDynamicRoutes).realmURL === 'string' &&
      Array.isArray((value as HostDynamicRoutes).routes)
    ) {
      return value as HostDynamicRoutes;
    }
    return undefined;
  }

  // Resolves a path no fixed rule matches through the realm's dynamic
  // routes, the way the realm server resolves a full page load of it, with
  // lookups that run as the visitor. `path` is what `resolveRoutedPath`
  // takes. Resolves to `undefined` when the realm has no dynamic routes,
  // the path is outside the realm, or no route resolves it: the caller then
  // loads the path as a card URL, which is also what the server serves for
  // a card's own path.
  //
  // `path` is relative to `hostModeOrigin`, the same base the caller
  // resolves a card URL against, so the realm's mount pathname is taken
  // relative to it before it is stripped, and a realm-relative redirect
  // target is prefixed with it, as the server prefixes a fixed rule's.
  async resolveDynamicRoutedPath(
    path: string,
  ): Promise<DynamicRoutedPath | undefined> {
    let dynamicRoutes = this.hostDynamicRoutes;
    // No routes at all, even in an incomplete set (`complete: false` with
    // every dynamic route dropped), is no dynamic routes: no route can match
    // the path, and serve-index answers 503 only for a path a route matched.
    if (!dynamicRoutes || dynamicRoutes.routes.length === 0) {
      return undefined;
    }
    let realmURL = new URL(dynamicRoutes.realmURL);
    let originPathname = new URL(`${this.hostModeOrigin}/`).pathname;
    if (!realmURL.pathname.startsWith(originPathname)) {
      return undefined;
    }
    let mountPathname = `/${realmURL.pathname.slice(originPathname.length)}`;
    let pathname = path.startsWith('/') ? path : `/${path}`;
    let canonical = normalizeRoutingPath(pathname);
    if (this.currentDynamicRoutedPath?.path === canonical) {
      return this.currentDynamicRoutedPath.result;
    }
    this.currentDynamicRoutedPath = undefined;
    let realmRoot = mountPathname.replace(/\/$/, '');
    if (pathname !== realmRoot && !pathname.startsWith(mountPathname)) {
      return undefined;
    }
    let resolution = await resolveHostRoute({
      path: `/${pathname.slice(mountPathname.length)}`,
      routes: dynamicRoutes.routes,
      realmURL,
      ...visitorHostRouteLookups({
        fetch: this.network.authedFetch,
        virtualNetwork: this.network.virtualNetwork,
        realmURL: realmURL.href,
      }),
    });
    let result: DynamicRoutedPath;
    switch (resolution.kind) {
      // An alias serves its card for now: redirecting to the card's
      // canonical address needs the reverse lookup from a card to its
      // address.
      case 'card':
      case 'alias':
        result = { kind: 'card', cardHref: resolution.cardHref };
        this.currentDynamicRoutedPath = { path: canonical, result };
        return result;
      case 'redirect':
        return {
          kind: 'redirect',
          redirectTo: resolveRedirectTarget(resolution.location, mountPathname),
        };
      case 'error':
        log.warn(
          `host route lookup for ${pathname} failed: ${
            resolution.error instanceof Error
              ? resolution.error.message
              : String(resolution.error)
          }`,
        );
        return { kind: 'error', error: resolution.error };
      case 'nothing':
        // With an incomplete route set, a route that would serve a path
        // some route matched may be one validation dropped for now, so the
        // path is not known to be missing, as on the server. A path no
        // route matched at all loads as it did before routes.
        if (dynamicRoutes.complete === false && resolution.trace.length > 0) {
          return { kind: 'unavailable' };
        }
        return undefined;
    }
  }

  // SPA-side counterpart of the server's HTTP redirect for a redirect
  // routing rule: a full-page navigation to matched paths gets the 3xx
  // from serve-index, but an in-app transition never leaves the SPA, so
  // the index route calls this instead. `replace` mirrors an HTTP
  // redirect, which leaves no history entry for the redirecting URL.
  // Goes through ember-window-mock's `window` so tests can intercept the
  // navigation.
  //
  // `queryParams` is the transition target's query, already filtered to
  // the params worth forwarding — NOT `window.location.search`, which
  // with HistoryLocation still shows the URL being navigated away from
  // while the transition is in flight. Matching serve-index's semantics,
  // it carries over only when the redirect target declares no query of
  // its own.
  //
  // A realm-relative target arrives already prefixed with the realm's
  // mount pathname, and resolves against the document's own origin —
  // what a browser does with a `Location: /path` header. Deliberately
  // NOT `hostModeOrigin`: that returns the `?hostModeOrigin=` query
  // param verbatim whenever it is present, which would let a visitor
  // pick the origin this navigates to. The two are the same value in
  // host mode anyway; only the simulation affordance separates them,
  // and a simulated session should stay on the page it is running from.
  redirectTo(target: string, queryParams?: Record<string, unknown>) {
    let url = isExternalRedirectTarget(target)
      ? new URL(target)
      : new URL(target, window.location.origin);
    if (!url.search && queryParams) {
      for (let [key, value] of Object.entries(queryParams)) {
        if (value == null) {
          continue;
        }
        // A repeated query param (`?tag=a&tag=b`) parses to an array;
        // append each value so the target carries `tag=a&tag=b` like the
        // server's verbatim search copy, not a collapsed `tag=a,b`.
        for (let v of Array.isArray(value) ? value : [value]) {
          url.searchParams.append(key, String(v));
        }
      }
    }
    window.location.replace(url.href);
  }

  get currentCardId() {
    if (this.isActive) {
      let stack = this.hostModeStateService.stackItems;

      if (stack.length > 0) {
        return stack[stack.length - 1];
      }
    }

    return this.operatorModeStateService.hostModePrimaryCard ?? undefined;
  }

  get publishedRealmMetadata() {
    let realmInfo = this.operatorModeStateService.currentRealmInfo;
    if (
      !realmInfo?.lastPublishedAt ||
      typeof realmInfo.lastPublishedAt !== 'object'
    ) {
      return [];
    }

    return Object.entries(realmInfo.lastPublishedAt)
      .map(
        ([url, publishedAt]) =>
          ({
            urlString: url,
            publishedAt: this.parsePublishedAt(publishedAt),
            currentCardUrlString: this.fullURL(url),
          }) as PublishedRealmMetadata,
      )
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }

  get publishedRealmURLs() {
    return this.publishedRealmMetadata.map(
      (publishedRealmMetadata) => publishedRealmMetadata.urlString,
    );
  }

  get defaultPublishedRealmURL() {
    return this.publishedRealmURLs[0];
  }

  get defaultPublishedSiteURL() {
    let defaultURL = this.defaultPublishedRealmURL;
    if (!defaultURL) {
      return undefined;
    }

    return this.fullURL(defaultURL);
  }

  fullURL(baseURL: string) {
    let cardId = this.currentCardId;
    if (!cardId) {
      return baseURL;
    }

    let fullURL = baseURL + cardId.replace(this.realmURL, '');

    if (fullURL === `${baseURL}index`) {
      // Strip trailing `/index` for host mode links
      fullURL = baseURL;
    }

    return fullURL;
  }

  lastPublishedTimestamp(url: string) {
    let metadata = this.publishedRealmMetadata.find(
      (entry) => entry.urlString === url,
    );
    return metadata ? metadata.publishedAt : null;
  }

  isPublished(url: string) {
    return this.lastPublishedTimestamp(url) !== null;
  }

  async updateHeadTemplate(cardURL?: string | null) {
    if (typeof document === 'undefined') {
      return;
    }

    let normalizedCardURL =
      (cardURL ?? this.currentCardId)?.replace(/\.json$/, '') ?? null;
    let requestId = ++this.headUpdateRequestId;

    if (normalizedCardURL === null) {
      // If there is no card, clear the head content
      this.headTemplateContainsTitle = false;
      this.replaceHeadTemplate(null);
      return;
    }

    let headHTML: string | null = null;
    try {
      let prerenderedHead = await this.fetchPrerenderedHead(normalizedCardURL);

      if (requestId !== this.headUpdateRequestId) {
        return;
      }

      if (prerenderedHead !== undefined) {
        headHTML = prerenderedHead;
      } else {
        return;
      }
    } catch (_error) {
      return;
    }

    if (requestId !== this.headUpdateRequestId) {
      return;
    }

    // Track whether the fetched head HTML contains a title
    this.headTemplateContainsTitle =
      headHTML !== null && headContainsTitle(headHTML);

    this.replaceHeadTemplate(
      headHTML !== null ? ensureSingleTitle(headHTML) : null,
    );
  }

  private async fetchPrerenderedHead(
    cardURL: string,
  ): Promise<string | null | undefined> {
    let card = new URL(cardURL);
    let realmRoot =
      this.realm.realmOf(card) ??
      new URL(
        card.pathname.replace(/[^/]+$/, ''),
        `${card.protocol}//${card.host}`,
      ).href;
    let realmServerURLs = this.realmServer.getRealmServersForRealms([
      realmRoot,
    ]);
    // TODO remove this assertion after multi-realm server/federated identity is supported
    this.realmServer.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;
    let hostModeOrigin = this.hostModeOrigin;
    if (
      hostModeOrigin &&
      new URL(realmServerURL).origin !== new URL(hostModeOrigin).origin
    ) {
      realmServerURL = hostModeOrigin;
    }
    let searchURL = new URL('_federated-search', realmServerURL);
    let cardJsonURL = cardURL.endsWith('.json') ? cardURL : `${cardURL}.json`;
    // The head markup is the `head` rendering of the card's `entry`:
    // an html-only query at `html.format: head`, scoped to the single card.
    // The head HTML rides on the resolved `html` resource in `included`,
    // reached through the entry's `html` relationship.
    let response = await fetch(searchURL.toString(), {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        realms: [realmRoot],
        cardUrls: [cardJsonURL],
        // `scope: 'cards'` pins the instance row, dropping the card `.json`'s
        // dual-indexed file row that shares the `cardUrls` URL — a by-URL card
        // lookup, so it's exactly the scope's purpose (and immune to the
        // un-restamped-rows window a stamp-based dedup depends on).
        scope: 'cards',
        filter: {
          eq: {
            htmlQuery: { eq: { format: 'head' } },
          },
        },
        fields: { entry: ['html'] },
      }),
    });

    if (!response.ok) {
      return undefined;
    }

    let json;
    try {
      json = await response.json();
    } catch (_error) {
      return undefined;
    }
    let htmlRef = json?.data?.[0]?.relationships?.html?.data?.[0];
    let headHTML: unknown;
    if (htmlRef?.id) {
      let htmlResource = (json?.included ?? []).find(
        (resource: { type?: string; id?: string }) =>
          resource?.type === 'html' && resource?.id === htmlRef.id,
      );
      headHTML = htmlResource?.attributes?.html;
    }
    return typeof headHTML === 'string' ? headHTML : null;
  }

  private replaceHeadTemplate(headHTML: string | null) {
    if (typeof document === 'undefined') {
      return;
    }

    let markers = this.findHeadMarkers();
    if (!markers) {
      return;
    }

    let [start, end] = markers;
    let parent = start.parentNode;

    if (!parent) {
      return;
    }

    for (let node = start.nextSibling; node && node !== end; ) {
      let next = node.nextSibling;
      parent.removeChild(node);
      node = next;
    }

    if (!headHTML || headHTML.trim().length === 0) {
      let fallback = document
        .createRange()
        .createContextualFragment(DEFAULT_HEAD_HTML);
      parent.insertBefore(fallback, end);
      return;
    }

    let sanitized = sanitizeHeadHTML(headHTML, document);
    if (sanitized) {
      parent.insertBefore(sanitized, end);
    } else {
      let fallback = document
        .createRange()
        .createContextualFragment(DEFAULT_HEAD_HTML);
      parent.insertBefore(fallback, end);
    }
  }

  private findHeadMarkers(): [Element, Element] | null {
    let head = document.head;
    if (!head) {
      return null;
    }

    let start: Element | null = head.querySelector('[data-boxel-head-start]');
    let end: Element | null = head.querySelector('[data-boxel-head-end]');

    return start && end ? [start, end] : null;
  }

  private parsePublishedAt(value: unknown) {
    let publishedAt = Number(value ?? 0);
    return Number.isFinite(publishedAt) ? publishedAt : 0;
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-mode-service': HostModeService;
  }
}
