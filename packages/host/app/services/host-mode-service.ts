import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import config from '@cardstack/host/config/environment';

export default class HostModeService extends Service {
  @service declare fastboot: { isFastBoot: boolean };

  get isActive() {
    if (!this.fastboot.isFastBoot && config.hostModeUserSubdomainRoot) {
      let hostModeUserSubdomainRoot = config.hostModeUserSubdomainRoot;
      let currentHost = window.location.hostname;

      if (currentHost.endsWith(`.${hostModeUserSubdomainRoot}`)) {
        return true;
      }

      if (this.simulatingHostMode) {
        return true;
      }
    }

    return false;
  }

  get simulatingHostMode() {
    return new URLSearchParams(window.location.search).has(
      'host-mode-subdomain',
    );
  }

  get userSubdomain() {
    if (this.simulatingHostMode) {
      return (
        new URLSearchParams(window.location.search).get(
          'host-mode-subdomain',
        ) || 'user'
      );
    }

    return window.location.hostname.split('.')[0];
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-mode-service': HostModeService;
  }
}
