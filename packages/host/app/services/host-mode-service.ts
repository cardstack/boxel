import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import config from '@cardstack/host/config/environment';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

interface PublishedRealmMetadata {
  urlString: string;
  publishedAt: number;
  currentCardUrlString: string | undefined;
}

export default class HostModeService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;
  private currentHeadCardURL: string | null = null;
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
    return this.operatorModeStateService.realmURL.href;
  }

  get currentCardId() {
    let stack = this.operatorModeStateService.hostModeStack;
    if (stack.length > 0) {
      return stack[stack.length - 1];
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
    let headHTML: string | null = null;
    let shouldReplace = normalizedCardURL === null;

    if (normalizedCardURL) {
      try {
        let response = await fetch(normalizedCardURL, {
          headers: { Accept: 'text/html' },
          credentials: 'include',
        });

        if (requestId !== this.headUpdateRequestId) {
          return;
        }

        if (response.ok) {
          headHTML = this.extractHeadTemplate(await response.text());
          console.log('head html?', headHTML);
          console.log('for', normalizedCardURL);
          shouldReplace = true;
        } else {
          return;
        }
      } catch (_error) {
        return;
      }
    }

    if (requestId !== this.headUpdateRequestId || !shouldReplace) {
      return;
    }

    this.replaceHeadTemplate(headHTML);
    this.currentHeadCardURL = normalizedCardURL;
  }

  private extractHeadTemplate(indexHTML: string): string | null {
    let match = indexHTML.match(/<!-- HEADSTART -->([\s\S]*?)<!-- HEADEND -->/);
    return match ? match[1].trim() : null;
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

  private findHeadMarkers(): [Comment, Comment] | null {
    let head = document.head;
    if (!head) {
      return null;
    }

    let start: Comment | null = null;
    let end: Comment | null = null;

    head.childNodes.forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        let content = (node as Comment).data.trim();
        if (content === 'HEADSTART') {
          start = node as Comment;
        } else if (content === 'HEADEND') {
          end = node as Comment;
        }
      }
    });

    if (start && end) {
      return [start, end];
    }

    return null;
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
