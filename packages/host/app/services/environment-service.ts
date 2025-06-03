import type Owner from '@ember/owner';
import Service from '@ember/service';

import config from '@cardstack/host/config/environment';

const { autoSaveDelayMs } = config;

// we use this service to help instrument environment settings in tests
export default class EnvironmentService extends Service {
  autoSaveDelayMs: number;

  constructor(owner: Owner) {
    super(owner);
    this.autoSaveDelayMs = autoSaveDelayMs;
  }
}

declare module '@ember/service' {
  interface Registry {
    'environment-service': EnvironmentService;
  }
}
