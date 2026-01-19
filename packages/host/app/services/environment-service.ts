import type Owner from '@ember/owner';
import Service from '@ember/service';

import config from '@cardstack/host/config/environment';

const { autoSaveDelayMs, cardSizeLimit } = config;

// we use this service to help instrument environment settings in tests
export default class EnvironmentService extends Service {
  autoSaveDelayMs: number;
  cardSizeLimit: number;

  constructor(owner: Owner) {
    super(owner);
    this.autoSaveDelayMs = autoSaveDelayMs;
    this.cardSizeLimit = cardSizeLimit;
  }
}

declare module '@ember/service' {
  interface Registry {
    'environment-service': EnvironmentService;
  }
}
