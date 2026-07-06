import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import { sanitizeHeadHTML } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

const DEFAULT_HEAD_HTML = '<title>Boxel</title>';

function headContainsTitle(html: string): boolean {
  return /<title[\s>]/.test(html);
}

function ensureSingleTitle(headHTML: string): string {
  return headContainsTitle(headHTML)
    ? headHTML
    : `${DEFAULT_HEAD_HTML}\n${headHTML}`;
}

// Normalize trailing-slash variance for routing-map matching. `/realm/`
// and `/realm` are the same destination from the user's perspective,
// but the injected map keys and Ember's `params.path` disagree on
// the trailing slash. Stripping it on both sides makes the comparator
// robust. Preserve the root `/` since stripping it would empty the path.
function canonicalizeRoutingPath(path: string): string {
  if (path === '/') return '/';
  return path.replace(/\/+$/, '');
}
import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type ResetService from '@cardstack/host/services/reset';

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
  @service declare reset: ResetService;

  // increasing token to ignore stale async head fetches
  private headUpdateRequestId = 0;

  // tracks whether the current head template contains a title tag
  @tracked headTemplateContainsTitle = false;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  resetState() {
    this.headUpdateRequestId = 0;
    this.headTemplateContainsTitle = false;
  }

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
  // rather than a window global.
  get hostRoutingMap(): { path: string; id: string }[] {
    let map = (config as { hostRoutingMap?: unknown }).hostRoutingMap;
    return Array.isArray(map) ? (map as { path: string; id: string }[]) : [];
  }

  // Returns the target card id if `path` matches a routing rule, else null.
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
  // Canonicalize both sides by stripping trailing slashes (except the
  // root `/` itself) before comparing so `/realm` ↔ `/realm/` resolve.
  resolveRoutedPath(path: string): string | null {
    let normalized = path.startsWith('/') ? path : `/${path}`;
    let canonical = canonicalizeRoutingPath(normalized);
    let rule = this.hostRoutingMap.find(
      (r) => canonicalizeRoutingPath(r.path) === canonical,
    );
    return rule ? rule.id : null;
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
        filter: { eq: { htmlQuery: { eq: { format: 'head' } } } },
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
