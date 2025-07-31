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

      return this.isUserSubdomain || this.isCustomSubdomain;
    }

    return false;
  }

  get isUserSubdomain() {
    if (this.simulatingHostMode) {
      return true;
    }

    if (config.hostModeUserSubdomainRoot) {
      let hostModeUserSubdomainRoot = config.hostModeUserSubdomainRoot;
      let currentHost = window.location.hostname;

      return currentHost.endsWith(`.${hostModeUserSubdomainRoot}`);
    }

    return false;
  }

  get isCustomSubdomain() {
    if (this.simulatingHostMode) {
      return true;
    }

    if (config.hostModeCustomSubdomainRoot) {
      let hostModeCustomSubdomainRoot = config.hostModeCustomSubdomainRoot;
      let currentHost = window.location.hostname;

      return currentHost.endsWith(`.${hostModeCustomSubdomainRoot}`);
    }

    return false;
  }

  get simulatingHostMode() {
    return new URLSearchParams(window.location.search).has(
      'host-mode-subdomain',
    );
  }

  // FIXME not user probably?
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

  customSubdomainToRealmUrl(_subdomain: string) {
    throw Error('Unimplemented: customSubdomainToRealmURL');
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-mode-service': HostModeService;
  }
}
