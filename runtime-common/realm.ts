import { Deferred } from "./deferred";
import { SearchIndex } from "./search-index";

export abstract class Realm {
  #startedUp = new Deferred<void>();
  #searchIndex = new SearchIndex(this);

  constructor(readonly url: string) {
    this.#startedUp.fulfill((() => this.#startup())());
  }

  abstract eachFile(): AsyncGenerator<{ path: string; contents: string }, void>;

  async #startup() {
    // Wait a microtask because our derived class will still be inside its
    // super() call to us and we don't want to start pulling on their "this" too
    // early.
    await Promise.resolve();

    await this.#searchIndex.run();
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  // TODO: eliminate this, the search index is an internal implementation detail
  // and its methods can go on the realm itself and delegate
  get searchIndex(): SearchIndex {
    return this.#searchIndex;
  }
}
