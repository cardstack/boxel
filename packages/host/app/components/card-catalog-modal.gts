import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { enqueueTask, restartableTask } from 'ember-concurrency';
import type { Card, CardContext } from 'https://cardstack.com/base/card-api';
import {
  createNewCard,
  type CardRef,
  type RealmInfo,
  type CreateNewCard,
} from '@cardstack/runtime-common';
import type { Query, Filter } from '@cardstack/runtime-common/query';
import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '../utils/text-suggestion';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { getSearchResults, Search } from '../resources/search';
import CardCatalogItem from './card-catalog-item';
import {
  Modal,
  CardContainer,
  Header,
  Button,
  IconButton,
  BoxelInputValidationState,
} from '@cardstack/boxel-ui';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { and, eq, gt, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
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
const DEFAULT_CHOOOSE_CARD_TITLE = 'Choose a Card';

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{! @glint-ignore Argument of type boolean
          is not assignable to currentRequest's params. }}
    {{#if (and this.currentRequest (not this.dismissModal))}}
      <Modal
        @size='large'
        @isOpen={{true}}
        @onClose={{fn this.pick undefined}}
        style={{this.styleString}}
        data-test-card-catalog-modal
      >
        <CardContainer class='dialog-box' @displayBoundaries={{true}}>
          <Header @title={{this.chooseCardTitle}} class='dialog-box__header'>
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
                <BoxelInputValidationState
                  class='boxel-searchbox__input'
                  @value={{this.searchKey}}
                  @onInput={{this.setSearchKey}}
                  @onKeyPress={{this.onSearchFieldKeypress}}
                  @state={{this.searchFieldState}}
                  @errorMessage={{this.searchErrorMessage}}
                  @placeholder='Search for a card type or enter card URL'
                  data-test-search-field
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
              <div class='card-catalog' data-test-card-catalog>
                {{#each this.cardsByRealm as |realm|}}
                  <section data-test-realm={{realm.name}}>
                    <header class='realm-info'>
                      <div
                        style={{if
                          realm.iconURL
                          (cssUrl 'background-image' realm.iconURL)
                        }}
                        class={{cn
                          'realm-icon'
                          realm-icon--empty=(not realm.iconURL)
                        }}
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
                            <CardCatalogItem
                              @isSelected={{eq this.selectedCard.id card.id}}
                              @title={{card.title}}
                              @description={{card.description}}
                              @thumbnailURL={{card.thumbnailURL}}
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
          <footer
            class={{cn
              'dialog-box__footer footer'
              (if this.currentRequest.opts.offerToCreate 'with-create-button')
            }}
          >
            {{#if this.currentRequest.opts.offerToCreate}}
              <Button
                @kind='secondary-light'
                @size='tall'
                class='create-new-button'
                {{on
                  'click'
                  (fn this.createNew this.currentRequest.opts.offerToCreate)
                }}
                data-test-card-catalog-create-new-button
              >
                {{svgJar
                  'icon-plus'
                  width='20'
                  height='20'
                  role='presentation'
                }}
                Create New
                {{this.cardRefName}}
              </Button>
            {{/if}}
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
      .dialog-box__header {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }
      .dialog-box__header > * + *:not(button) {
        margin-top: var(--boxel-sp);
      }
      .boxel-searchbox {
        position: relative;
        width: 100%;
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
      :global(.boxel-searchbox__input .boxel-input) {
        padding-right: var(--boxel-sp-xl);
        background-color: var(--boxel-600);
        border-color: #707070;
        color: var(--boxel-light);
        font: var(--boxel-font-sm);
        font-weight: 400;
        letter-spacing: var(--boxel-lsp-xs);
      }
      :global(.boxel-searchbox__input .boxel-input::placeholder) {
        color: var(--boxel-300);
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
        justify-content: flex-end;
        /* This bottom margin is neccesary to show card URL error messages */
        margin-bottom: var(--boxel-sp);
      }
      .footer.with-create-button {
        justify-content: space-between;
      }
      .create-new-button {
        --icon-color: var(--boxel-highlight);
        display: flex;
        justify-content: center;
        align-items: center;

        gap: var(--boxel-sp-xxs);
      }

      .realm-info {
        --realm-icon-size: 1.25rem;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .realm-icon {
        width: var(--realm-icon-size);
        height: var(--realm-icon-size);
        background-size: contain;
        background-position: center;
      }
      .realm-icon--empty {
        border: 1px solid var(--boxel-dark);
        border-radius: 100px;
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
        opts?: {
          offerToCreate?: CardRef;
          createNewCard?: CreateNewCard;
        };
      }
    | undefined = undefined;
  @tracked zIndex = 20;
  @tracked selectedCard?: Card = undefined;
  @tracked searchKey = '';
  @tracked hasSearchError = false;
  @tracked urlSearchVisible = false;
  @tracked chooseCardTitle = DEFAULT_CHOOOSE_CARD_TITLE;
  @tracked dismissModal = false;
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
            iconURL: instance.realmInfo.iconURL
              ? new URL(instance.realmInfo.iconURL, this.cardService.defaultURL)
                  .href
              : null,
            cards: [instance.card],
          };
          realmCards.push(realm);
        }
      }
    }

    return realmCards.filter((r) => r.cards.length);
  }

  get styleString() {
    return htmlSafe(`z-index: ${this.zIndex}`);
  }

  get searchFieldState() {
    return this.hasSearchError ? 'invalid' : 'initial';
  }

  get searchErrorMessage() {
    return this.hasSearchError ? 'Not a valid search key' : undefined;
  }

  get cardRefName() {
    return (
      (
        this.currentRequest?.opts?.offerToCreate as {
          module: string;
          name: string;
        }
      ).name ?? 'Card'
    );
  }

  private resetState() {
    this.searchKey = '';
    this.hasSearchError = false;
    this.selectedCard = undefined;
    this.urlSearchVisible = false;
    this.dismissModal = false;
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard<T extends Card>(
    query: Query,
    opts?: {
      offerToCreate?: CardRef;
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
    }
  ): Promise<undefined | T> {
    this.zIndex++;
    this.chooseCardTitle = chooseCardTitle(query.filter, opts?.multiSelect);
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

  private getCard = restartableTask(async (searchKey: string) => {
    //TODO: Handle fetching card using non-URL search key
    let response = await this.loaderService.loader.fetch(searchKey, {
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
    this.hasSearchError = true;
  });

  debouncedSearchFieldUpdate = debounce(() => {
    if (!this.searchKey) {
      this.selectedCard = undefined;
      return;
    }
    //TODO: Remove this URL validation after implementing search feature with non-URL.
    try {
      new URL(this.searchKey);
    } catch (e: any) {
      if (e instanceof TypeError && e.message.includes('Invalid URL')) {
        return;
      }
      throw e;
    }
    this.onSearchFieldUpdated();
  }, 500);

  @action
  displayURLSearch() {
    this.urlSearchVisible = true;
  }

  @action
  hideURLSearchIfBlank() {
    if (!this.searchKey.trim()) {
      this.urlSearchVisible = false;
    }
  }

  @action
  setSearchKey(searchKey: string) {
    this.hasSearchError = false;
    this.selectedCard = undefined;
    this.searchKey = searchKey;
    this.debouncedSearchFieldUpdate();
  }

  @action
  onSearchFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.searchKey) {
      this.getCard.perform(this.searchKey);
    }
  }

  @action
  onSearchFieldUpdated() {
    if (this.searchKey) {
      this.selectedCard = undefined;
      this.getCard.perform(this.searchKey);
    }
  }

  @action toggleSelect(card?: Card): void {
    this.searchKey = '';
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
    let newCard;
    this.dismissModal = true;
    if (this.currentRequest?.opts?.createNewCard) {
      newCard = await this.currentRequest?.opts?.createNewCard(ref, undefined, {
        isLinkedCard: true,
      });
    } else {
      newCard = await createNewCard(ref, undefined);
    }
    this.pick(newCard);
  }
}

function chooseCardTitle(
  filter: Filter | undefined,
  multiSelect?: boolean
): string {
  if (!filter) {
    return DEFAULT_CHOOOSE_CARD_TITLE;
  }
  let suggestions = suggestCardChooserTitle(filter, 0, { multiSelect });
  return (
    getSuggestionWithLowestDepth(suggestions) ?? DEFAULT_CHOOOSE_CARD_TITLE
  );
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardCatalogModal: typeof CardCatalogModal;
  }
}
