import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { BrowserQueue } from '../lib/browser-queue';

import type ResetService from './reset';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class QueueService extends Service {
  queue = new BrowserQueue();
  @service declare reset: ResetService;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  resetState() {
    this.queue.destroy();
    this.queue = new BrowserQueue();
  }
}

declare module '@ember/service' {
  interface Registry {
    queue: QueueService;
  }
}
