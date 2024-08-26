import ApplicationInstance from '@ember/application/instance';

import config from '@cardstack/host/config/environment';

export function initialize(appInstance: ApplicationInstance): void {
  if (config.environment !== 'production' && typeof window !== 'undefined') {
    let globalName = config.modulePrefix;
    let global = window as any;

    if (!global[globalName]) {
      global[globalName] = appInstance;

      appInstance.willDestroy = function () {
        delete global[globalName];
      };
    }
  }
}

export default {
  initialize,
};
