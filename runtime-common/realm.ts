import { Deferred } from "./deferred";
import { SearchIndex } from "./search-index";

export abstract class Realm {
  #startedUp = new Deferred<void>();
  #searchIndex = new SearchIndex(this);

  readonly url: string;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "") + "/";
    this.#startedUp.fulfill((() => this.#startup())());
  }

  abstract readdir(
    path: string
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void>;

  abstract openFile(
    path: string
  ): Promise<ReadableStream<Uint8Array> | Uint8Array | string>;

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

export type Kind = "file" | "directory";
