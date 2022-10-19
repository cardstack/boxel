import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { taskFor } from 'ember-concurrency-ts';
import { enqueueTask } from 'ember-concurrency';
import type { Card } from 'https://cardstack.com/base/card-api';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import type { Query } from '@cardstack/runtime-common/query';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { getSearchResults, Search } from '../resources/search';
import { cardInstance } from '../resources/card-instance';
import Preview from './preview';

export default class CardCatalogModal extends Component {
  <template>
    {{#if this.currentRequest}}
      <dialog class="dialog-box" open data-test-card-catalog-modal>
        <button {{on "click" (fn this.pick undefined)}} type="button">X Close</button>
        <h1>Card Catalog</h1>
        <div>
          {{#if this.currentRequest.search.isLoading}}
            Loading...
          {{else}}
            <ul class="card-catalog" data-test-card-catalog>
              {{#each this.cards as |card|}}
                {{#if card}}
                  <li data-test-card-catalog-item={{card.id}}>
                    <Preview @card={{card}} @format="embedded" />
                    <button {{on "click" (fn this.pick card)}} type="button" data-test-select={{card.id}}>
                      Select
                    </button>
                  </li>
                {{/if}}
              {{else}}
                <p>No cards available</p>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      </dialog>
    {{/if}}
  </template>

  @tracked currentRequest: {
    search: Search;
    deferred: Deferred<Card | undefined>;
  } | undefined = undefined;

  @cached
  get cardInstances() {
    return this.currentRequest?.search.instances?.map((instance) => cardInstance(this, () => instance));
  }
  @cached
  get cards() {
    return this.cardInstances?.map((c) => c.instance);
  }

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  async chooseCard<T extends Card>(query: Query): Promise<undefined | T> {
    return await taskFor(this._chooseCard).perform(query) as T | undefined;
  }

  @enqueueTask private async _chooseCard<T extends Card>(query: Query): Promise<undefined | T> {
    this.currentRequest = {
      search: getSearchResults(this, () => query),
      deferred: new Deferred(),
    };
    let card = await this.currentRequest.deferred.promise;
    if (card) {
      return card as T;
    } else {
      return undefined;
    }
  }

  @action pick(card?: Card): void {
    if (this.currentRequest) {
      this.currentRequest.deferred.resolve(card);
      this.currentRequest = undefined;
    }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardCatalogModal: typeof CardCatalogModal;
   }
}
