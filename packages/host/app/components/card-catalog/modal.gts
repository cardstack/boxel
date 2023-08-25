import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { registerDestructor } from '@ember/destroyable';
import { enqueueTask } from 'ember-concurrency';
import debounce from 'lodash/debounce';
import type { CardDef, CardContext } from 'https://cardstack.com/base/card-api';
import {
  createNewCard,
  type CodeRef,
  type CreateNewCard,
  Deferred,
} from '@cardstack/runtime-common';
import type { Query, Filter } from '@cardstack/runtime-common/query';
import { Button, SearchInput } from '@cardstack/boxel-ui';
import { and, eq, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';
import { getSearchResults, Search } from '../../resources/search';
import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '../../utils/text-suggestion';
import ModalContainer from '../modal-container';
import CardCatalog from './index';
import CardCatalogFilters from './filters';
import UrlSearch from '../url-search';
import { type RealmInfo } from '@cardstack/runtime-common';
import { TrackedArray } from 'tracked-built-ins';

interface Signature {
  Args: {
    context?: CardContext;
  };
}

export interface RealmCards {
  url: string | null;
  realmInfo: RealmInfo;
  cards: CardDef[];
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
            @variant='large'
            @value={{this.searchKey}}
            @onInput={{this.setSearchKey}}
            @onKeyPress={{this.onSearchFieldKeypress}}
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
            {{! The getter for availableRealms is necessary because
                it's a resource that needs to load the search results }}
            <CardCatalog
              @results={{if
                this.availableRealms.length
                this.searchResults
                this.availableRealms
              }}
              @toggleSelect={{this.toggleSelect}}
              @selectedCard={{this.selectedCard}}
              @context={{@context}}
            />
          {{/if}}
        </:content>
        <:footer>
          <div class='footer'>
            <div class='footer__actions-left'>
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
              <UrlSearch
                @cardURL={{this.cardURL}}
                @setCardURL={{this.setCardURL}}
                @setSelectedCard={{this.setSelectedCard}}
              />
            </div>
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
        gap: var(--boxel-sp);
      }
      .footer__actions-left {
        display: flex;
        gap: var(--boxel-sp);
        flex-grow: 1;
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

  @tracked currentRequest:
    | {
        search: Search;
        deferred: Deferred<CardDef | undefined>;
        opts?: {
          offerToCreate?: CodeRef;
          createNewCard?: CreateNewCard;
        };
      }
    | undefined = undefined;
  @tracked zIndex = 20;
  @tracked selectedCard?: CardDef = undefined;
  @tracked searchKey = '';
  @tracked searchResults: RealmCards[] = [];
  @tracked cardURL = '';
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

  get availableRealms(): RealmCards[] {
    // returns all available realms and their cards that match a certain type criteria
    // realm filters and search key filter these groups of cards
    // filters dropdown menu will always display all available realms
    if (this.currentRequest?.search.instancesByRealm.length) {
      this.searchResults = this.currentRequest?.search.instancesByRealm;
    }
    return this.currentRequest?.search.instancesByRealm ?? [];
  }

  get displayedRealms(): RealmCards[] {
    // filters the available realm cards by selected realms
    return this.selectedRealms.length
      ? this.selectedRealms
      : this.availableRealms;
  }

  _selectedRealms = new TrackedArray<RealmCards>([]);

  get selectedRealms(): RealmCards[] {
    return this._selectedRealms;
  }

  @action onSelectRealm(realm: RealmCards) {
    this._selectedRealms.push(realm);
    this.onSearchFieldUpdated();
  }

  @action onDeselectRealm(realm: RealmCards) {
    let selectedRealmIndex = this._selectedRealms.findIndex(
      (r) => r.url === realm.url,
    );
    this._selectedRealms.splice(selectedRealmIndex, 1);
    this.onSearchFieldUpdated();
  }

  private resetState() {
    this.searchKey = '';
    this.searchResults = this.availableRealms;
    this.cardURL = '';
    this.selectedCard = undefined;
    this.dismissModal = false;
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard<T extends CardDef>(
    query: Query,
    opts?: {
      offerToCreate?: CodeRef;
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
    },
  ): Promise<undefined | T> {
    this.zIndex++;
    this.chooseCardTitle = chooseCardTitle(query.filter, opts?.multiSelect);
    return (await this._chooseCard.perform(query, opts)) as T | undefined;
  }

  private _chooseCard = enqueueTask(
    async <T extends CardDef>(
      query: Query,
      opts: { offerToCreate?: CodeRef } = {},
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

  @action
  setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    if (!this.searchKey) {
      this.resetState();
    } else {
      this.debouncedSearchFieldUpdate();
    }
  }

  debouncedSearchFieldUpdate = debounce(() => this.onSearchFieldUpdated(), 500);

  @action setCardURL(cardURL: string) {
    this.selectedCard = undefined;
    this.cardURL = cardURL;
  }

  @action setSelectedCard(card: CardDef | undefined) {
    this.selectedCard = card;
  }

  @action
  onSearchFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.onSearchFieldUpdated();
    }
  }

  @action
  onSearchFieldUpdated() {
    if (!this.searchKey && !this.selectedRealms.length) {
      return this.resetState();
    }
    let results: RealmCards[] = [];
    for (let { url, realmInfo, cards } of this.displayedRealms) {
      let filteredCards = cards.filter((c) =>
        c.title
          .trim()
          .toLowerCase()
          .includes(this.searchKey.trim().toLowerCase()),
      );
      if (filteredCards.length) {
        results.push({
          url,
          realmInfo,
          cards: filteredCards,
        });
      }
    }
    this.searchResults = results;
  }

  @action toggleSelect(card?: CardDef): void {
    this.cardURL = '';
    if (this.selectedCard?.id === card?.id) {
      this.selectedCard = undefined;
      return;
    }
    this.selectedCard = card;
  }

  @action pick(card?: CardDef) {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(card);
      this.currentRequest = undefined;
    }
    this.resetState();
  }

  @action cancel(): void {
    this.resetState();
  }

  @action async createNew(ref: CodeRef): Promise<void> {
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
    'CardCatalog::Modal': typeof CardCatalogModal;
  }
}
