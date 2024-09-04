import Service from '@ember/service';

import config from '@cardstack/host/config/environment';

const { autoSaveDelayMs } = config;

// we use this service to help instrument environment settings in tests
export default class EnvironmentService extends Service {
  autoSaveDelayMs: number;

  constructor(properties: object) {
    super(properties);
    this.autoSaveDelayMs = autoSaveDelayMs;
  }
}
