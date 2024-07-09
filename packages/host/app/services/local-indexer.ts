import Service from '@ember/service';

import {
  type IndexResults,
  type IndexUpdater,
  type RealmAdapter,
} from '@cardstack/runtime-common';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class LocalIndexer extends Service {
  setup(
    _fromScratch: (realmURL: URL) => Promise<IndexResults>,
    _incremental: (
      url: URL,
      realmURL: URL,
      operation: 'update' | 'delete',
      ignoreData: Record<string, string>,
    ) => Promise<IndexResults>,
  ) {}
  get adapter(): RealmAdapter {
    return {} as RealmAdapter;
  }
  get indexUpdater(): IndexUpdater {
    return {} as IndexUpdater;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-indexer': LocalIndexer;
  }
}
