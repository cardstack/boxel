import Service from '@ember/service';

import { type Indexer, type RealmAdapter } from '@cardstack/runtime-common';
import {
  SearchEntryWithErrors,
  type RunState,
} from '@cardstack/runtime-common/search-index';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class LocalIndexer extends Service {
  setup(
    _fromScratch: (realmURL: URL) => Promise<RunState>,
    _incremental: (
      prev: RunState,
      url: URL,
      operation: 'update' | 'delete',
    ) => Promise<RunState>,
  ) {}
  get adapter(): RealmAdapter {
    return {} as RealmAdapter;
  }
  get indexer(): Indexer {
    return {} as Indexer;
  }
  async setEntry(_url: URL, _entry: SearchEntryWithErrors) {}
}

declare module '@ember/service' {
  interface Registry {
    'local-indexer': LocalIndexer;
  }
}
