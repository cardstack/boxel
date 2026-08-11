import type Owner from '@ember/owner';
import Service from '@ember/service';

import config from '@cardstack/host/config/environment';

const {
  autoSaveDelayMs,
  cardSizeLimitBytes,
  fileSizeLimitBytes,
  audioSizeLimitBytes,
  videoSizeLimitBytes,
} = config;

// we use this service to help instrument environment settings in tests
export default class EnvironmentService extends Service {
  autoSaveDelayMs: number;
  cardSizeLimitBytes: number;
  fileSizeLimitBytes: number;
  audioSizeLimitBytes: number;
  videoSizeLimitBytes: number;

  constructor(owner: Owner) {
    super(owner);
    this.autoSaveDelayMs = autoSaveDelayMs;
    this.cardSizeLimitBytes = cardSizeLimitBytes;
    this.fileSizeLimitBytes = fileSizeLimitBytes;
    this.audioSizeLimitBytes = audioSizeLimitBytes;
    this.videoSizeLimitBytes = videoSizeLimitBytes;
  }
}

declare module '@ember/service' {
  interface Registry {
    'environment-service': EnvironmentService;
  }
}
