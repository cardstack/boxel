import Service from '@ember/service';

import { type Worker } from '@cardstack/runtime-common';

// TODO do we really need this??

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class WorkerService extends Service {
  worker: Worker | undefined;
}

declare module '@ember/service' {
  interface Registry {
    worker: WorkerService;
  }
}
