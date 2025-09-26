import Service from '@ember/service';

import {
  type IndexResults,
  type IndexWriter,
  type Prerenderer,
  type FromScratchArgsWithPermissions,
  type IncrementalArgsWithPermissions,
} from '@cardstack/runtime-common';

import { type TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class LocalIndexer extends Service {
  setup(
    _fromScratch: (
      args: FromScratchArgsWithPermissions,
    ) => Promise<IndexResults>,
    _incremental: (
      args: IncrementalArgsWithPermissions,
    ) => Promise<IndexResults>,
    _prerenderer: Prerenderer,
  ) {}
  get adapter(): TestRealmAdapter {
    return {} as TestRealmAdapter;
  }
  get indexWriter(): IndexWriter {
    return {} as IndexWriter;
  }
  get prerenderer() {
    return {} as Prerenderer;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-indexer': LocalIndexer;
  }
}
