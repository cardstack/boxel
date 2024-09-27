import Service from '@ember/service';

import { BrowserQueue } from '../lib/browser-queue';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class QueueService extends Service {
  queue = new BrowserQueue();
}

declare module '@ember/service' {
  interface Registry {
    queue: QueueService;
  }
}
