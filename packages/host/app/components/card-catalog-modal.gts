import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { enqueueTask } from 'ember-concurrency';
import type { Card } from 'https://cardstack.com/base/card-api';
import type { Query } from '@cardstack/runtime-common/query';
import { createNewCard, type CardRef } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { getSearchResults, Search } from '../resources/search';
import Preview from './preview';
import { Modal, CardContainer, Header, Button } from '@cardstack/boxel-ui';

export default class CardCatalogModal extends Component {
  <template>
    {{#if this.currentRequest}}
      <Modal
        @size='large'
        @isOpen={{true}}
        @onClose={{fn this.pick undefined}}
        style='z-index:{{this.zIndex}}'
        data-test-card-catalog-modal
      >
        <CardContainer class='dialog-box' @displayBoundaries={{true}}>
          <Header @title='Choose a card type'>
            <button
              {{on 'click' (fn this.pick undefined)}}
              class='dialog-box__close'
            >x</button>
          </Header>
          <div class='dialog-box__content'>
            {{#if this.currentRequest.search.isLoading}}
              Loading...
            {{else}}
              {{#if this.currentRequest.opts.offerToCreate}}
                <Button
                  @size='small'
                  {{on
                    'click'
                    (fn this.createNew this.currentRequest.opts.offerToCreate)
                  }}
                  data-test-create-new
                >Create New</Button>
              {{/if}}
              <ul class='card-catalog' data-test-card-catalog>
                {{#each this.currentRequest.search.instances as |card|}}
                  <li data-test-card-catalog-item={{card.id}}>
                    <Preview @card={{card}} @format='embedded' />
                    <button
                      {{on 'click' (fn this.pick card)}}
                      data-test-select={{card.id}}
                    >
                      Select
                    </button>
                  </li>
                {{else}}
                  <p>No cards available</p>
                {{/each}}
              </ul>
            {{/if}}
          </div>
        </CardContainer>
      </Modal>
    {{/if}}
  </template>

  @tracked currentRequest:
    | {
        search: Search;
        deferred: Deferred<Card | undefined>;
        opts?: { offerToCreate?: CardRef };
      }
    | undefined = undefined;

  @tracked zIndex = 20;
  @action incrementZIndex() {
    this.zIndex++;
  }

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  async chooseCard<T extends Card>(
    query: Query,
    opts?: { offerToCreate?: CardRef }
  ): Promise<undefined | T> {
    this.incrementZIndex();
    return (await this._chooseCard.perform(query, opts)) as T | undefined;
  }

  private _chooseCard = enqueueTask(
    async <T extends Card>(
      query: Query,
      opts: { offerToCreate?: CardRef } = {}
    ) => {
      this.currentRequest = {
        search: getSearchResults(this, () => query),
        deferred: new Deferred(),
        opts,
      };
      let card = await this.currentRequest.deferred.promise;
      if (card) {
        return card as T;
      } else {
        return undefined;
      }
    }
  );

  @action pick(card?: Card): void {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(card);
      this.currentRequest = undefined;
    }
  }

  @action async createNew(ref: CardRef): Promise<void> {
    let newCard = await createNewCard(ref, undefined);
    this.pick(newCard);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardCatalogModal: typeof CardCatalogModal;
  }
}
