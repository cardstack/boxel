import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Deferred } from '@cardstack/runtime-common/deferred';
import type RouterService from '@ember/routing/router-service';
import type LoaderService from './loader-service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import {
  type Reader,
  type RunState,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';

export default class IndexerService extends Service {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @tracked card: Card | undefined;
  @tracked format: Format | undefined;
  #reader: Reader | undefined;
  #setRunState: ((state: RunState) => void) | undefined;
  #entrySetter: ((url: URL, entry: SearchEntryWithErrors) => void) | undefined;
  #prevRunState: RunState | undefined;
  private deferred: Deferred<string> | undefined;

  setup(
    reader: Reader,
    setRunState: (state: RunState) => void,
    entrySetter: (url: URL, entry: SearchEntryWithErrors) => void,
    prev?: RunState
  ) {
    this.#reader = reader;
    this.#setRunState = setRunState;
    this.#entrySetter = entrySetter;
    this.#prevRunState = prev;
  }

  async index(indexerPath: string) {
    // TODO this needs to work like visitCard
    // the visited urls/cards should be added as a tracked property in this service...
    await this.router.recognizeAndLoad(indexerPath);
  }

  get reader(): Reader {
    if (!this.#reader) {
      throw new Error(`reader has not been provided`);
    }
    return this.#reader;
  }

  get setRunState(): (state: RunState) => void {
    if (!this.#setRunState) {
      throw new Error(`setRunState has not been provided`);
    }
    return this.#setRunState;
  }

  get prevRunState(): RunState | undefined {
    return this.#prevRunState;
  }

  get entrySetter(): (url: URL, entry: SearchEntryWithErrors) => void {
    if (!this.#entrySetter) {
      throw new Error(`entrySetter has not been provided`);
    }
    return this.#entrySetter;
  }

  // TODO this can go away...
  async visitCard(
    path: string,
    staticResponses: Map<string, string>,
    send: (html: string) => void
  ) {
    this.loaderService.setStaticResponses(staticResponses);
    let { attributes } = await this.router.recognizeAndLoad(path);
    let { card, format } = attributes as { card: Card; format: Format };
    this.deferred = new Deferred();
    this.card = card;
    this.format = format;
    let html = await this.deferred.promise;
    send(html);
  }

  captureSnapshot(html: string) {
    if (!this.deferred) {
      throw new Error(`unexpected snapshot received:\n${html}`);
    }
    this.deferred.fulfill(html);
  }
}
