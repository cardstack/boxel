import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { registerDestructor } from '@ember/destroyable';
import { enqueueTask, restartableTask } from 'ember-concurrency';
import debounce from 'lodash/debounce';
import flatMap from 'lodash/flatMap';
import type { Card, CardContext } from 'https://cardstack.com/base/card-api';
import {
  baseRealm,
  catalogEntryRef,
  createNewCard,
  isSingleCardDocument,
  type CardRef,
  type CreateNewCard,
  Deferred,
} from '@cardstack/runtime-common';
import type { Query, Filter } from '@cardstack/runtime-common/query';
import { Button, SearchInput, BoxelInputValidationState } from '@cardstack/boxel-ui';
import { and, eq, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import cn from '@cardstack/boxel-ui/helpers/cn';
import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import { getSearchResults, Search } from '../resources/search';
import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '../utils/text-suggestion';
import ModalContainer from './modal-container';
import CardCatalog from './card-catalog/index';
import CardCatalogFilters from './card-catalog/filters';
import { type RealmInfo } from '@cardstack/runtime-common';
import { TrackedArray } from 'tracked-built-ins';
import ENV from '@cardstack/host/config/environment';

const { otherRealmURLs } = ENV;

interface Signature {
  Args: {
    context?: CardContext;
  };
}

export interface RealmCards {
  url: string | null;
  realmInfo: RealmInfo;
  cards: Card[];
}

const DEFAULT_CHOOOSE_CARD_TITLE = 'Choose a Card';

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{! @glint-ignore Argument of type boolean
          is not assignable to currentRequest's params. }}
    {{#if (and this.currentRequest (not this.dismissModal))}}
      <ModalContainer
        @title={{this.chooseCardTitle}}
        @onClose={{fn this.pick undefined}}
        @zIndex={{this.zIndex}}
        data-test-card-catalog-modal
      >
        <:header>
          <SearchInput
            @value={{this.searchKey}}
            @onInput={{this.setSearchKey}}
            @placeholder='Search for a card'
            data-test-search-field
          />
          <CardCatalogFilters
            @availableRealms={{this.availableRealms}}
            @selectedRealms={{this.selectedRealms}}
            @onSelectRealm={{this.onSelectRealm}}
            @onDeselectRealm={{this.onDeselectRealm}}
          />
        </:header>
        <:content>
          {{#if this.currentRequest.search.isLoading}}
            Loading...
          {{else}}
            <CardCatalog
              @results={{this.displayedRealms}}
              @toggleSelect={{this.toggleSelect}}
              @selectedCard={{this.selectedCard}}
              @context={{@context}}
            />
          {{/if}}
        </:content>
        <:footer>
          <div
            class={{cn
              'footer'
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
            {{else}}
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
            {{/if}}
            <div>
              <Button
                @kind='secondary-light'
                @size='tall'
                class='footer-button'
                {{on 'click' this.cancel}}
                data-test-card-catalog-cancel-button
              >
                Cancel
              </Button>
              <Button
                @kind='primary'
                @size='tall'
                @disabled={{eq this.selectedCard undefined}}
                class='footer-button'
                {{on 'click' (fn this.pick this.selectedCard)}}
                data-test-card-catalog-go-button
              >
                Go
              </Button>
            </div>
          </div>
        </:footer>
      </ModalContainer>
    {{/if}}
    <style>
      .footer {
        display: flex;
        justify-content: space-between;
      }
      .url-search {
        flex-grow: 0.5;
        display: grid;
        grid-template-columns: auto 1fr;
        justify-items: flex-start;
        gap: var(--boxel-sp-xs);
      }
      .url-search > span {
        padding-top: var(--boxel-sp-xxs);
        font: 700 var(--boxel-font-sm);
      }
      .footer-button + .footer-button {
        margin-left: var(--boxel-sp-xs);
      }
      .create-new-button {
        --icon-color: var(--boxel-highlight);
        display: flex;
        justify-content: center;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
    </style>
  </template>

  _selectedRealms = new TrackedArray<RealmCards>([]);
  searchCardResults = new TrackedArray<Card>();
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
  @tracked cardURL = '';
  @tracked hasCardURLError = false;
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

  get cardURLFieldState() {
    return this.hasCardURLError ? 'invalid' : 'initial';
  }

  get cardURLErrorMessage() {
    return this.hasCardURLError ? 'Not a valid Card URL' : undefined;
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

  get displayedRealms(): RealmCards[] {
    // if no realms are selected, display all realms
    return this.selectedRealms.length
      ? this.selectedRealms
      : this.availableRealms;
  }

  get availableRealms(): RealmCards[] {
    return this.currentRequest?.search.instancesByRealm ?? [];
  }

  get selectedRealms(): RealmCards[] {
    return this._selectedRealms;
  }

  @action onSelectRealm(realm: RealmCards) {
    this._selectedRealms.push(realm);
  }

  @action onDeselectRealm(realm: RealmCards) {
    let selectedRealmIndex = this._selectedRealms.findIndex(
      (r) => r.url === realm.url,
    );
    this._selectedRealms.splice(selectedRealmIndex, 1);
  }

  private resetState() {
    this.searchKey = '';
    this.cardURL = '';
    this.hasCardURLError = false;
    this.selectedCard = undefined;
    this.dismissModal = false;
    this.searchCardResults.splice(0, this.searchCardResults.length);
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard<T extends Card>(
    query: Query,
    opts?: {
      offerToCreate?: CardRef;
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
    },
  ): Promise<undefined | T> {
    this.zIndex++;
    this.chooseCardTitle = chooseCardTitle(query.filter, opts?.multiSelect);
    return (await this._chooseCard.perform(query, opts)) as T | undefined;
  }

  private _chooseCard = enqueueTask(
    async <T extends Card>(
      query: Query,
      opts: { offerToCreate?: CardRef } = {},
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
    },
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
          new URL(maybeCardDoc.data.id),
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
        this.hasCardURLError = true;
        return;
      }
      throw e;
    }
    this.onURLFieldUpdated();
  }, 500);

  @action
  setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    this.debouncedSearchFieldUpdate();
  }

  debouncedSearchFieldUpdate = debounce(() => {
    if (!this.searchKey) {
      this.searchCardResults.splice(0, this.searchCardResults.length);
      return;
    }
    this.onSearchFieldUpdated();
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
  onSearchFieldUpdated() {
    if (this.searchKey) {
      this.searchCardResults.splice(0, this.searchCardResults.length);
      this.searchCard.perform(this.searchKey);
    }
  }

  @action
  onURLFieldUpdated() {
    if (this.cardURL) {
      this.selectedCard = undefined;
      this.getCard.perform(this.cardURL);
    }
  }

  private searchCard = restartableTask(async (searchKey: string) => {
    let query = {
      filter: {
        every: [
          { type: catalogEntryRef },
          {
            contains: {
              title: searchKey
            },
          },
        ],
      },
    };

    let cards = flatMap(
      await Promise.all(
        [...new Set([
          this.cardService.defaultURL.href,
          baseRealm.url,
          ...otherRealmURLs,
        ])].map(
          async (realm) => await this.cardService.search(query, new URL(realm)),
        ),
      ),
    );

    if (cards.length > 0) {
      this.searchCardResults.push(...cards);
    } else {
      this.searchCardResults.splice(0, this.searchCardResults.length);
    }
    console.log(searchKey, ...this.searchCardResults);
  });

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
  multiSelect?: boolean,
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
