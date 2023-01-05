import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Deferred } from '@cardstack/runtime-common/deferred';
import type RouterService from '@ember/routing/router-service';
import type LoaderService from './loader-service';
import CardService from './card-service';
import type { Card } from 'https://cardstack.com/base/card-api';
import {
  type Reader,
  type RunState,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';

export default class IndexerService extends Service {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked card: Card | undefined;
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

  async visitCard(
    url: string,
    staticResponses: Map<string, string>,
    send: (html: string) => void // we use a callback here because it works well for the message channel--reconsider this if we stop doing that...
  ) {
    this.loaderService.setStaticResponses(staticResponses);
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      send(`card ${url} not found`); // TODO make this better...
    } else {
      this.deferred = new Deferred();
      debugger;
      this.card = card;
      let html = await this.deferred.promise;
      send(html);
    }
  }

  captureSnapshot(html: string) {
    if (!this.deferred) {
      throw new Error(`unexpected snapshot received:\n${html}`);
    }
    this.deferred.fulfill(html);
  }
}
