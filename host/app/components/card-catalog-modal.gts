import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { taskFor } from 'ember-concurrency-ts';
import { enqueueTask } from 'ember-concurrency';
import { service } from '@ember/service';
import type { Card } from 'https://cardstack.com/base/card-api';
import { type LooseCardResource } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { getSearchResults, Search } from '../resources/search';
import type LocalRealm from '../services/local-realm';
import type LoaderService from '../services/loader-service';
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
              {{#each this.currentRequest.search.instances as |entry|}}
                <li data-test-card-catalog-item={{entry.id}}>
                  <Preview
                    @card={{hash type="existing" url=entry.id format="embedded"}}
                  />
                  <button {{on "click" (fn this.pick entry)}} type="button" data-test-select={{entry.id}}>
                    Select
                  </button>
                </li>
              {{else}}
                <p>No cards available</p>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      </dialog>
    {{/if}}
  </template>

  @service declare localRealm: LocalRealm;
  @service declare loaderService: LoaderService;

  @tracked currentRequest: {
    search: Search;
    deferred: Deferred<LooseCardResource | undefined>;
  } | undefined;

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
      search: getSearchResults(this, () => query, () => this.loaderService.loader),
      deferred: new Deferred(),
    };
    let resource = await this.currentRequest.deferred.promise;
    if (resource) {
      let api = await this.loaderService.loader.import<typeof import('https://cardstack.com/base/card-api')>('https://cardstack.com/base/card-api');
      return await api.createFromSerialized(resource, this.localRealm.url, { loader: this.loaderService.loader }) as T;
    } else {
      return undefined;
    }
  }

  @action pick(resource?: LooseCardResource): void {
    if (this.currentRequest) {
      this.currentRequest.deferred.resolve(resource);
      this.currentRequest = undefined;
    }
  }
}


declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardCatalogModal: typeof CardCatalogModal;
   }
}
