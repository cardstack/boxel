import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { enqueueTask, restartableTask } from 'ember-concurrency';
import type { Card, CardContext } from 'https://cardstack.com/base/card-api';
import type { Query } from '@cardstack/runtime-common/query';
import { createNewCard, type CardRef } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { getSearchResults, Search } from '../resources/search';
import Preview from './preview';
import {
  Modal,
  CardContainer,
  Header,
  Button,
  IconButton,
  BoxelInputValidationState,
} from '@cardstack/boxel-ui';
import { eq, gt } from '@cardstack/boxel-ui/helpers/truth-helpers';
import cn from '@cardstack/boxel-ui/helpers/cn';
import debounce from 'lodash/debounce';
import { service } from '@ember/service';
import { isSingleCardDocument } from '@cardstack/runtime-common';
import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

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
              {{#let
                this.currentRequest.search.instances.length
                as |numResults|
              }}
                <div class='results-length'>
                  {{#if (gt numResults 1)}}
                    {{numResults}}
                    results
                  {{else if (eq numResults 1)}}
                    1 result
                  {{/if}}
                </div>
              {{/let}}
              <ul class='card-catalog' data-test-card-catalog>
                {{#each this.currentRequest.search.instances as |card|}}
                  <li
                    class={{cn
                      'item'
                      selected=(eq this.selectedCard.id card.id)
                    }}
                    data-test-card-catalog-item={{card.id}}
                  >
                    <Preview
                      @card={{card}}
                      @format='embedded'
                      @context={{@context}}
                    />
                    <button
                      class='select'
                      {{on 'click' (fn this.toggleSelect card)}}
                      data-test-select={{card.id}}
                      aria-label='Select'
                    />
                    <IconButton
                      class='hover-button preview'
                      @icon='eye'
                      aria-label='preview'
                    />
                    <IconButton
                      class='hover-button more-actions'
                      @icon='more-actions'
                      aria-label='more actions'
                    />
                  </li>
                {{else}}
                  <p>No cards available</p>
                {{/each}}
              </ul>
            {{/if}}
          </div>
          <footer class='dialog-box__footer footer'>
            <label class='url-search'>
              <span>Enter Card URL:</span>
              <BoxelInputValidationState
                data-test-url-field
                placeholder='http://'
                @value={{this.cardURL}}
                @onInput={{this.setCardURL}}
                @onKeyPress={{this.onURLFieldKeypress}}
                @state={{this.cardURLFieldState}}
                @errorMessage={{this.cardURLErrorMessage}}
              />
            </label>
            <div>
              <Button
                @kind='secondary-light'
                @size='tall'
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
                {{on 'click' (fn this.pick this.selectedCard)}}
                data-test-card-catalog-go-button
              >
                Go
              </Button>
            </div>
          </footer>
        </CardContainer>
      </Modal>
    {{/if}}
    <style>
      .url-search > .boxel-input {
        border-color: transparent;
        padding-left: var(--boxel-sp-xxs);
      }

      .footer {
        display: flex;
        justify-content: space-between;
        /* This bottom margin is neccesary to show card URL error messages */
        margin-bottom: var(--boxel-sp);
      }
      .url-search {
        flex-grow: 0.5;
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        justify-items: flex-start;
        gap: var(--boxel-sp-xs);
      }
      .url-search > span {
        font: 700 var(--boxel-font-sm);
      }

      .card-catalog {
        list-style-type: none;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(16.25rem, 1fr));
        gap: var(--boxel-sp);
        padding-left: 0;
        margin: 0;
      }
      .results-length {
        font: 700 var(--boxel-font);
        height: var(--boxel-sp-xxl);
      }

      .item {
        position: relative;
        height: 6.25rem;
      }

      .item > :deep(.boxel-card-container) {
        display: flex;
        align-items: center;
        height: 100%;
      }
      .item.selected > :deep(.boxel-card-container) {
        box-shadow: 0 0 0 2px var(--boxel-highlight);
      }

      .select {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius);
      }
      .item:hover > .select:not(:disabled) {
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
        cursor: pointer;
      }
      .item > .hover-button {
        display: none;
        width: 30px;
        height: 30px;
      }
      .hover-button:not(:disabled):hover {
        --icon-color: var(--boxel-highlight);
      }
      .item:hover > .hover-button:not(:disabled) {
        display: block;
        position: absolute;
      }
      .preview {
        top: 0;
        left: 0;
      }
      .more-actions {
        bottom: 0;
        right: 0;
      }
      .preview > svg,
      .more-actions > svg {
        height: 100%;
      }
    </style>
  </template>

  @tracked currentRequest:
    | {
        search: Search;
        deferred: Deferred<Card | undefined>;
        opts?: { offerToCreate?: CardRef };
      }
    | undefined = undefined;
  @tracked zIndex = 20;
  @tracked selectedCard?: Card = undefined;
  @tracked cardURL = '';
  @tracked hasCardURLError = false;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

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

  get cardURLFieldState() {
    return this.hasCardURLError ? 'invalid' : 'initial';
  }

  get cardURLErrorMessage() {
    return this.hasCardURLError ? 'Not a valid Card URL' : undefined;
  }

  private resetState() {
    this.cardURL = '';
    this.hasCardURLError = false;
    this.selectedCard = undefined;
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard<T extends Card>(
    query: Query,
    opts?: { offerToCreate?: CardRef }
  ): Promise<undefined | T> {
    this.zIndex++;
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

  private getCard = restartableTask(async (cardURL: string) => {
    let response = await this.loaderService.loader.fetch(cardURL, {
      headers: {
        Accept: 'application/vnd.card+json',
      },
    });
    if (response.ok) {
      let maybeCardDoc = await response.json();
      if (isSingleCardDocument(maybeCardDoc)) {
        this.selectedCard = await this.cardService.createFromSerialized(
          maybeCardDoc.data,
          maybeCardDoc,
          new URL(maybeCardDoc.data.id)
        );
        return;
      }
    }
    this.selectedCard = undefined;
    this.hasCardURLError = true;
  });

  debouncedURLFieldUpdate = debounce(() => {
    if (!this.cardURL) {
      this.selectedCard = undefined;
      return;
    }
    try {
      new URL(this.cardURL);
    } catch (e: any) {
      if (e instanceof TypeError && e.message.includes('Invalid URL')) {
        return;
      }
      throw e;
    }
    this.onURLFieldUpdated();
  }, 500);

  @action
  setCardURL(cardURL: string) {
    this.hasCardURLError = false;
    this.selectedCard = undefined;
    this.cardURL = cardURL;
    this.debouncedURLFieldUpdate();
  }

  @action
  onURLFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.cardURL) {
      this.getCard.perform(this.cardURL);
    }
  }

  @action
  onURLFieldUpdated() {
    if (this.cardURL) {
      this.selectedCard = undefined;
      this.getCard.perform(this.cardURL);
    }
  }

  @action toggleSelect(card?: Card): void {
    this.cardURL = '';
    if (this.selectedCard?.id === card?.id) {
      this.selectedCard = undefined;
      return;
    }
    this.selectedCard = card;
  }

  @action pick(card?: Card) {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(card);
      this.currentRequest = undefined;
    }
    this.resetState();
  }

  @action cancel(): void {
    this.resetState();
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
