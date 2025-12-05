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

  get isActive() {
    if (this.simulatingHostMode) {
      return true;
    }

    return (
      !config.hostsOwnAssets &&
      this.isRealmServerDomain === false &&
      this.originIsNotMatrixTests
    );

    return false;
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
