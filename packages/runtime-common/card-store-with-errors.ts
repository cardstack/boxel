import { loadDocument } from './document';
import type { SingleCardDocument } from './document-types';
import type { CardError } from './error';

import type { CardDef, CardStore } from 'https://cardstack.com/base/card-api';

export class CardStoreWithErrors implements CardStore {
  #cards = new Map<string, CardDef>();
  #fetch: typeof globalThis.fetch;
  #inFlight: Promise<unknown>[] = [];
  #docsInFlight: Map<string, Promise<SingleCardDocument | CardError>> =
    new Map();

  constructor(fetch: typeof globalThis.fetch) {
    this.#fetch = fetch;
  }

  get(id: string): CardDef | undefined {
    id = id.replace(/\.json$/, '');
    return this.#cards.get(id);
  }
  set(id: string, instance: CardDef): void {
    id = id.replace(/\.json$/, '');
    this.#cards.set(id, instance);
  }
  setNonTracked(id: string, instance: CardDef) {
    id = id.replace(/\.json$/, '');
    return this.#cards.set(id, instance);
  }
  makeTracked(_id: string) {}

  readonly errors = new Set<string>();

  async loadDocument(url: string) {
    let promise = this.#docsInFlight.get(url);
    if (promise) {
      return await promise;
    }
    try {
      promise = loadDocument(this.#fetch, url);
      this.#docsInFlight.set(url, promise);
      return await promise;
    } finally {
      this.#docsInFlight.delete(url);
    }
  }
  trackLoad(load: Promise<unknown>) {
    this.#inFlight.push(load);
  }
  async loaded() {
    await Promise.allSettled(this.#inFlight);
  }
}
