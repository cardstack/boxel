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
import {
  createNewCard,
  type CardRef,
  type RealmInfo,
} from '@cardstack/runtime-common';
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
  BoxelInput,
} from '@cardstack/boxel-ui';
import { eq, gt } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
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

type RealmCards = {
  name: RealmInfo['name'];
  iconURL: RealmInfo['iconURL'];
  cards: Card[];
};

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
          <Header @title={{this.catalogTitle}}>
            <IconButton
              @icon='icon-x'
              {{on 'click' (fn this.pick undefined)}}
              class='dialog-box__close'
              aria-label='close modal'
            />
            <div class='boxel-searchbox'>
              <span class='boxel-searchbox__search-icon'>
                {{svgJar 'search' class='search-icon'}}
              </span>
              <label>
                <span class='boxel-sr-only'>Search</span>
                <BoxelInput
                  class='boxel-searchbox__input'
                  @value=''
                  @placeholder='Search for a card type'
                />
              </label>
            </div>
            <div class='tags'>
              <IconButton
                class='add-tag-button'
                @icon='icon-plus'
                @width='20'
                @height='20'
                aria-label='add tag'
              />
              <ul class='tag-list'>
                <li>
                  <div class='tag'>
                    Realm: All
                    <IconButton @icon='icon-x' class='remove-tag-button' />
                  </div>
                </li>
              </ul>
            </div>
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
              <div class='card-catalog' data-test-card-catalog>
                {{#each this.cardsByRealm as |realm|}}
                  <section>
                    <header class='realm-info'>
                      <img
                        src={{realm.iconURL}}
                        class='realm-icon'
                        role='presentation'
                      />
                      <span
                        class='realm-name'
                        data-test-realm-name
                      >{{realm.name}}</span>
                      <span class='results-count'>
                        {{#if (gt realm.cards.length 1)}}
                          {{realm.cards.length}}
                          results
                        {{else if (eq realm.cards.length 1)}}
                          1 result
                        {{/if}}
                      </span>
                    </header>
                    {{#if realm.cards.length}}
                      <ul class='card-catalog__group'>
                        {{#each realm.cards as |card|}}
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
                          </li>
                        {{/each}}
                      </ul>
                    {{else}}
                      <p>No cards available</p>
                    {{/if}}
                  </section>
                {{else}}
                  <p>No cards available</p>
                {{/each}}
              </div>
            {{/if}}
          </div>
          <footer class='dialog-box__footer footer'>
            <label
              {{on 'click' this.displayURLSearch}}
              {{on 'focusout' this.hideURLSearchIfBlank}}
              class={{cn
                'url-search'
                url-search--visible=this.urlSearchVisible
              }}
            >
              <div class='url-search__label'>
                {{svgJar
                  'icon-link'
                  width='20'
                  height='14'
                  class='url-search__icon'
                  role='presentation'
                }}
                Enter Card URL
              </div>
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
      .boxel-searchbox {
        position: relative;
        width: 100%;
        margin-top: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }
      .boxel-searchbox__search-icon {
        --icon-color: var(--boxel-highlight);
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        width: var(--boxel-sp-xl);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .boxel-searchbox__input {
        padding-right: var(--boxel-sp-xl);
        background-color: var(--boxel-100);
        border-color: #707070;
      }
      .tags {
        --tag-height: 30px;
        display: flex;
        gap: var(--boxel-sp-xs);
        font: 500 var(--boxel-font-sm);
      }
      .add-tag-button {
        --icon-color: var(--boxel-highlight);
        border: 1px solid var(--boxel-400);
        border-radius: 100px;
        width: var(--tag-height);
        height: var(--tag-height);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .add-tag-button:hover {
        border-color: var(--boxel-dark);
      }
      .tag-list {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-flow: row wrap;
        gap: var(--boxel-sp-xs);
      }
      .tag {
        position: relative;
        height: var(--tag-height);
        border: 1px solid var(--boxel-400);
        border-radius: 20px;
        padding-right: var(--boxel-sp-xl);
        padding-left: var(--boxel-sp-sm);
        display: flex;
        align-items: center;
      }
      .remove-tag-button {
        --icon-bg: var(--boxel-400);
        position: absolute;
        right: 0;
        width: var(--boxel-sp-lg);
        height: var(--tag-height);
        background: none;
        border: none;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .remove-tag-button:hover {
        --icon-bg: var(--boxel-dark);
      }
      .footer {
        display: flex;
        justify-content: space-between;
        /* This bottom margin is neccesary to show card URL error messages */
        margin-bottom: var(--boxel-sp);
      }
      .url-search {
        --input-visibility: hidden;
        --input-width: 0px;

        flex-grow: 0;
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        justify-items: flex-start;
        border: 1px solid var(--boxel-border-color);
        border-radius: 100px;
        transition: border-color var(--boxel-transition),
          box-shadow var(--boxel-transition), flex-grow var(--boxel-transition);
      }
      .url-search:hover {
        border-color: var(--boxel-dark);
        cursor: pointer;
      }
      .url-search:focus-within {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .url-search:focus-within,
      .url-search--visible {
        --input-visibility: visible;
        --input-width: 100%;
        flex-grow: 0.5;
      }
      .url-search :deep(.boxel-input),
      .url-search :deep(.boxel-input:hover),
      .url-search :deep(.boxel-input:focus) {
        border: none;
        background: none;
        box-shadow: none;
        outline: none;
        padding: 0;

        visibility: var(--input-visibility);
        width: var(--input-width);
      }
      .url-search__label {
        display: inline-block;
        justify-self: center;
        font: 700 var(--boxel-font-sm);
        padding: 0 var(--boxel-sp-lg) 0 var(--boxel-sp);
      }

      .realm-info {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .realm-icon {
        width: 1.25rem;
        height: 1.25rem;
      }
      .realm-name {
        display: inline-block;
        font: 700 var(--boxel-font);
      }
      .results-count {
        display: inline-block;
        font: var(--boxel-font);
      }

      .card-catalog {
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .card-catalog__group {
        list-style-type: none;
        padding-top: var(--boxel-sp);
        padding-left: var(--boxel-sp-lg);
        margin: 0;
        display: grid;
        gap: var(--boxel-sp);
      }

      .item {
        position: relative;
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
        height: 100%;
      }
      .hover-button:not(:disabled):hover {
        --icon-color: var(--boxel-highlight);
      }
      .item:hover > .hover-button:not(:disabled) {
        position: absolute;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .preview {
        right: 0;
        top: 0;
      }
      .preview > svg {
        height: 100%;
      }

    </style>
  </template>

  @tracked currentRequest:
    | {
        search: Search;
        deferred: Deferred<Card | undefined>;
        opts?: { offerToCreate?: CardRef; catalogTitle?: string };
      }
    | undefined = undefined;
  @tracked zIndex = 20;
  @tracked selectedCard?: Card = undefined;
  @tracked cardURL = '';
  @tracked hasCardURLError = false;
  @tracked urlSearchVisible = false;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  get cardsByRealm(): RealmCards[] {
    let realmCards: RealmCards[] = [];
    let instances = this.currentRequest?.search.instancesWithRealmInfo ?? [];

    if (instances.length) {
      for (let instance of instances) {
        let realm = realmCards.find((r) => r.name === instance.realmInfo?.name);
        if (realm) {
          realm.cards.push(instance.card);
        } else {
          realm = {
            name: instance.realmInfo.name,
            iconURL: instance.realmInfo.iconURL,
            cards: [],
          };
          realmCards.push(realm);
        }
      }
    }

    return realmCards.filter((r) => r.cards.length);
  }

  get catalogTitle() {
    return this.currentRequest?.opts?.catalogTitle ?? 'Card Catalog';
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
    this.urlSearchVisible = false;
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
  displayURLSearch() {
    this.urlSearchVisible = true;
  }

  @action
  hideURLSearchIfBlank() {
    if (!this.cardURL.trim()) {
      this.urlSearchVisible = false;
    }
  }

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
