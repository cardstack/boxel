import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import config from '@cardstack/host/config/environment';
import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

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

  // increasing token to ignore stale async head fetches
  private headUpdateRequestId = 0;

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
    return (
      this.hostModeOrigin !== 'http://localhost:4202' &&
      this.hostModeOrigin !== 'http://localhost:4205'
    );
  }

  get realmURL() {
    return this.operatorModeStateService.realmURL;
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

    this.replaceHeadTemplate(headHTML);
  }

  private async fetchPrerenderedHead(
    cardURL: string,
  ): Promise<string | null | undefined> {
    let card = new URL(cardURL);
    let realmRoot =
      this.realm.realmOfURL(card)?.href ??
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
    let searchURL = new URL('_search-prerendered', realmServerURL);
    let cardJsonURL = cardURL.endsWith('.json') ? cardURL : `${cardURL}.json`;
    let response = await fetch(searchURL.toString(), {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
      },
      credentials: 'include',
      body: JSON.stringify({
        realms: [realmRoot],
        prerenderedHtmlFormat: 'head',
        cardUrls: [cardJsonURL],
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
    let headHTML: unknown = json?.data?.[0]?.attributes?.html;
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
      return;
    }

    let fragment = document.createRange().createContextualFragment(headHTML);
    parent.insertBefore(fragment, end);
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
