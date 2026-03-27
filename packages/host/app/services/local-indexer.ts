import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type { IndexWriter, Prerenderer } from '@cardstack/runtime-common';

import type { TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';

import type ResetService from './reset';

// Tests inject an implementation of this service to help perform indexing
// for the test-realm-adapter
export default class LocalIndexer extends Service {
  @service declare reset: ResetService;
  @tracked renderError: string | undefined;
  @tracked prerenderStatus: 'ready' | 'loading' | 'unusable' | undefined;
  #prerenderer: Prerenderer | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  resetState() {
    this.renderError = undefined;
    this.prerenderStatus = undefined;
    this.teardown();
  }

  setup(prerenderer: Prerenderer) {
    if (this.#prerenderer === prerenderer) {
      return;
    }
    this.#prerenderer = prerenderer;
  }
  teardown(prerenderer?: Prerenderer) {
    if (prerenderer && this.#prerenderer !== prerenderer) {
      return;
    }
    this.#prerenderer = undefined;
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
