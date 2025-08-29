import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import config from '@cardstack/host/config/environment';

export default class HostModeService extends Service {
  @service declare fastboot: { isFastBoot: boolean };

  get isActive() {
    if (!this.fastboot.isFastBoot) {
      if (this.simulatingHostMode) {
        return true;
      }

      return (
        config.hostsOwnAssets === false &&
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

    if (config.realmServerDomain) {
      let realmServerDomain = config.realmServerDomain;
      let currentHost = window.location.hostname;

      return (
        currentHost.endsWith(`.${realmServerDomain}`) &&
        // FIXME hack for testing
        !currentHost.startsWith('published.localhost')
      );
    }

    return false;
  }

  get simulatingHostMode() {
    return new URLSearchParams(window.location.search).has('host-mode-origin');
  }

  get hostModeOrigin() {
    if (this.simulatingHostMode) {
      return new URLSearchParams(window.location.search).get(
        'host-mode-origin',
      );
    }

    return window.location.origin;
  }

  get originIsNotMatrixTests() {
    return (
      this.hostModeOrigin !== 'http://localhost:4202' &&
      this.hostModeOrigin !== 'http://localhost:4205'
    );
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-mode-service': HostModeService;
  }
}
