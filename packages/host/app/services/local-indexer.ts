import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

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
  @tracked renderError: string | undefined;
  @tracked prerenderStatus: 'ready' | 'loading' | 'unusable' | undefined;
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
  setPrerenderStatus(status: 'ready' | 'loading' | 'unusable') {
    this.prerenderStatus = status;
  }
  setRenderError(error: string) {
    this.renderError = error;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-indexer': LocalIndexer;
  }
}
