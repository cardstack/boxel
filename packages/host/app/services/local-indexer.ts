import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type {
  IndexResults,
  IndexWriter,
  Prerenderer,
  FromScratchArgsWithPermissions,
  IncrementalArgsWithPermissions,
} from '@cardstack/runtime-common';

import type { TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class LocalIndexer extends Service {
  @tracked renderError: string | undefined;
  @tracked prerenderStatus: 'ready' | 'loading' | 'unusable' | undefined;
  #prerenderer: Prerenderer | undefined;
  setup(
    _fromScratch: (
      args: FromScratchArgsWithPermissions,
    ) => Promise<IndexResults>,
    _incremental: (
      args: IncrementalArgsWithPermissions,
    ) => Promise<IndexResults>,
    prerenderer: Prerenderer,
  ) {
    this.#prerenderer = prerenderer;
  }
  get adapter(): TestRealmAdapter {
    return {} as TestRealmAdapter;
  }
  get indexWriter(): IndexWriter {
    return {} as IndexWriter;
  }
  get prerenderer() {
    if (!this.#prerenderer) {
      throw new Error('prerenderer has not been configured on LocalIndexer');
    }
    return this.#prerenderer;
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
