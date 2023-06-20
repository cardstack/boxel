import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { enqueueTask } from 'ember-concurrency';
import type {
  CardBase,
  CardContext,
} from 'https://cardstack.com/base/card-api';
import type { Query } from '@cardstack/runtime-common/query';
import { createNewCard, type CardRef } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { getSearchResults, Search } from '../resources/search';
import Preview from './preview';
import { Modal, CardContainer, Header, Button } from '@cardstack/boxel-ui';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import cn from '@cardstack/boxel-ui/helpers/cn';

interface Signature {
  Args: {
    context?: CardContext;
  };
}

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{#if this.currentRequest}}
      <Modal
        @size='large'
        @isOpen={{true}}
        @onClose={{fn this.pick undefined}}
        style={{this.styleString}}
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
                  <li
                    class={{cn
                      'card-catalog-item'
                      is-selected=(eq this.selectedCard.id card.id)
                    }}
                    data-test-card-catalog-item={{card.id}}
                  >
                    <Preview
                      @card={{card}}
                      @format='embedded'
                      @context={{@context}}
                    />
                    <button
                      class='card-catalog-item__select'
                      {{on 'click' (fn this.pick card)}}
                      data-test-select={{card.id}}
                      aria-label='Select'
                    />
                  </li>
                {{else}}
                  <p>No cards available</p>
                {{/each}}
              </ul>
            {{/if}}
          </div>
          <footer class='dialog-box__footer'>
            <Button
              @kind='secondary-light'
              @size='tall'
              @disabled={{eq this.selectedCard undefined}}
              class='dialog-box__footer-button'
              {{on 'click' this.cancel}}
              data-test-card-catalog-cancel-button
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
              @disabled={{eq this.selectedCard undefined}}
              class='dialog-box__footer-button'
              {{on 'click' this.go}}
              data-test-card-catalog-go-button
            >
              Go
            </Button>
          </footer>
        </CardContainer>
      </Modal>
    {{/if}}
  </template>

  @tracked currentRequest:
    | {
        search: Search;
        deferred: Deferred<CardBase | undefined>;
        opts?: { offerToCreate?: CardRef };
      }
    | undefined = undefined;
  @tracked zIndex = 20;
  @tracked selectedCard?: CardBase;

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  get styleString() {
    return htmlSafe(`z-index: ${this.zIndex}`);
  }

  async chooseCard<T extends CardBase>(
    query: Query,
    opts?: { offerToCreate?: CardRef }
  ): Promise<undefined | T> {
    this.zIndex++;
    return (await this._chooseCard.perform(query, opts)) as T | undefined;
  }

  private _chooseCard = enqueueTask(
    async <T extends CardBase>(
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

  @action pick(card?: CardBase): void {
    this.selectedCard = card;
  }

  @action go() {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(this.selectedCard);
      this.currentRequest = undefined;
    }
  }

  @action cancel(): void {
    this.selectedCard = undefined;
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
