import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import config from '@cardstack/host/config/environment';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

export default class HostModeService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare operatorModeStateService: OperatorModeStateService;

  get isActive() {
    if (!this.fastboot.isFastBoot) {
      if (this.simulatingHostMode) {
        return true;
      }

      return (
        !config.hostsOwnAssets &&
        this.isRealmServerDomain === false &&
        this.originIsNotMatrixTests
      );
    }

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

  get publishedRealmEntries() {
    let realmInfo = this.operatorModeStateService.currentRealmInfo;
    if (
      !realmInfo?.lastPublishedAt ||
      typeof realmInfo.lastPublishedAt !== 'object'
    ) {
      return [];
    }

    return Object.entries(realmInfo.lastPublishedAt)
      .map(([url, value]) => [url, this.parsePublishedAt(value)] as const)
      .sort(([, a], [, b]) => b - a);
  }

  get publishedRealmURLs() {
    return this.publishedRealmEntries.map(([url]) => url);
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

    return baseURL + cardId.replace(this.realmURL, '');
  }

  lastPublishedTimestamp(url: string) {
    let entry = this.publishedRealmEntries.find(
      ([publishedUrl]) => publishedUrl === url,
    );
    return entry ? entry[1] : null;
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
