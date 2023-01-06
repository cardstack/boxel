import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { schedule } from '@ember/runloop';
import type RouterService from '@ember/routing/router-service';
import type LoaderService from './loader-service';
import CardService from './card-service';
import type { Card } from 'https://cardstack.com/base/card-api';
import {
  type Reader,
  type RunState,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';
import type { SimpleDocument } from '@simple-dom/interface';

async function afterRender() {
  return new Promise<void>((res) => {
    schedule('afterRender', function () {
      res();
    });
  });
}

export default class IndexerService extends Service {
  @service('-document') document: SimpleDocument;
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;

  @tracked card: Card | undefined;
  @tracked realmURL: string | undefined;
  @tracked updatedURL: string | undefined;
  @tracked operation: 'delete' | 'update' | undefined;

  #reader: Reader | undefined;
  #setRunState: ((state: RunState) => void) | undefined;
  #entrySetter: ((url: URL, entry: SearchEntryWithErrors) => void) | undefined;
  #prevRunState: RunState | undefined;
  indexRunDeferred: Deferred<void> | undefined;

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
    staticResponses: Map<string, string>
  ): Promise<string> {
    this.loaderService.setStaticResponses(staticResponses);
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      throw new Error(`card ${url} not found`);
    } else {
      this.card = card;
      await afterRender();
      // the latest render will be available 1 micro task after the render
      await Promise.resolve();
      let serializer = new Serializer(voidMap);
      let html = serializer.serialize(this.document); // TODO use simple DOM to get this component's element instead of using whole doc
      return html;
    }
  }
}
