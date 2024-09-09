import Service from '@ember/service';

import { type IndexResults, type IndexWriter } from '@cardstack/runtime-common';

import { type TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';

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
  get adapter(): TestRealmAdapter {
    return {} as TestRealmAdapter;
  }
  get indexWriter(): IndexWriter {
    return {} as IndexWriter;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-indexer': LocalIndexer;
  }
}
