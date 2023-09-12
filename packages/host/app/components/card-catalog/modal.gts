import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { registerDestructor } from '@ember/destroyable';
import { task } from 'ember-concurrency';
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
import { and, bool, eq, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
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
import { TrackedArray, TrackedObject } from 'tracked-built-ins';

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

type Request = {
  search: Search;
  deferred: Deferred<CardDef | undefined>;
  opts?: {
    offerToCreate?: CodeRef;
    createNewCard?: CreateNewCard;
  };
};

type State = {
  request?: Request;
  selectedCard?: CardDef;
  selectedRealms: RealmCards[];
  searchKey: string;
  searchResults: RealmCards[];
  cardURL: string;
  chooseCardTitle: string;
  dismissModal: boolean;
};

const DEFAULT_CHOOOSE_CARD_TITLE = 'Choose a Card';

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{#if (and (bool this.state.request) (not this.state.dismissModal))}}
      <ModalContainer
        @title={{this.state.chooseCardTitle}}
        @onClose={{fn this.pick undefined}}
        @zIndex={{this.zIndex}}
        data-test-card-catalog-modal
      >
        <:header>
          <SearchInput
            @variant='large'
            @value={{this.state.searchKey}}
            @onInput={{this.setSearchKey}}
            @onKeyPress={{this.onSearchFieldKeypress}}
            @placeholder='Search for a card'
            data-test-search-field
          />
          <CardCatalogFilters
            @availableRealms={{this.availableRealms}}
            @selectedRealms={{this.state.selectedRealms}}
            @onSelectRealm={{this.onSelectRealm}}
            @onDeselectRealm={{this.onDeselectRealm}}
          />
        </:header>
        <:content>
          {{#if this.request.search.isLoading}}
            Loading...
          {{else}}
            {{! The getter for availableRealms is necessary because
                it's a resource that needs to load the search results }}
            <CardCatalog
              @results={{if
                this.availableRealms.length
                this.state.searchResults
                this.availableRealms
              }}
              @toggleSelect={{this.toggleSelect}}
              @selectedCard={{this.state.selectedCard}}
              @context={{@context}}
            />
          {{/if}}
        </:content>
        <:footer>
          <div class='footer'>
            <div class='footer__actions-left'>
              {{#if this.request.opts.offerToCreate}}
                <Button
                  @kind='secondary-light'
                  @size='tall'
                  class='create-new-button'
                  {{on
                    'click'
                    (fn this.createNew this.request.opts.offerToCreate)
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
                @cardURL={{this.state.cardURL}}
                @setCardURL={{this.setCardURL}}
                @setSelectedCard={{this.setSelectedCard}}
              />
            </div>
            <div>
              <Button
                @kind='secondary-light'
                @size='tall'
                class='footer-button'
                {{on 'click' (fn this.pick undefined)}}
                data-test-card-catalog-cancel-button
              >
                Cancel
              </Button>
              <Button
                @kind='primary'
                @size='tall'
                @disabled={{eq this.state.selectedCard undefined}}
                class='footer-button'
                {{on 'click' (fn this.pick this.state.selectedCard)}}
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

  stateStack: State[] = new TrackedArray<State>();
  @tracked zIndex = 20;
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
        this.request?.opts?.offerToCreate as {
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
    if (this.request?.search.instancesByRealm.length) {
      this.state.searchResults = this.request?.search.instancesByRealm;
    }
    return this.request?.search.instancesByRealm ?? [];
  }

  get displayedRealms(): RealmCards[] {
    // filters the available realm cards by selected realms
    return this.state.selectedRealms.length
      ? this.state.selectedRealms
      : this.availableRealms;
  }

  get request(): Request | undefined {
    return this.state.request;
  }

  get state(): State {
    if (this.stateStack.length <= 0) {
      return {} as State;
    }

    return this.stateStack[this.stateStack.length - 1];
  }

  @action onSelectRealm(realm: RealmCards) {
    this.state.selectedRealms.push(realm);
    this.onSearchFieldUpdated();
  }

  @action onDeselectRealm(realm: RealmCards) {
    let selectedRealmIndex = this.state.selectedRealms.findIndex(
      (r) => r.url === realm.url,
    );
    this.state.selectedRealms.splice(selectedRealmIndex, 1);
    this.onSearchFieldUpdated();
  }

  private resetState() {
    this.state.searchKey = '';
    this.state.searchResults = this.availableRealms;
    this.state.cardURL = '';
    this.state.selectedCard = undefined;
    this.state.dismissModal = false;
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
    return (await this._chooseCard.perform(query, opts)) as T | undefined;
  }

  private _chooseCard = task(
    async <T extends CardDef>(
      query: Query,
      opts: { offerToCreate?: CodeRef; multiSelect?: boolean } = {},
    ) => {
      let title = chooseCardTitle(query.filter, opts?.multiSelect);
      let request = new TrackedObject<Request>({
        search: getSearchResults(this, () => query),
        deferred: new Deferred(),
        opts,
      });
      let cardCatalogState = new TrackedObject<State>({
        request,
        chooseCardTitle: title,
        searchKey: '',
        cardURL: '',
        searchResults: new TrackedArray<RealmCards>([]),
        selectedRealms: new TrackedArray<RealmCards>([]),
        dismissModal: false,
      });
      this.stateStack.push(cardCatalogState);

      let card = await request.deferred.promise;
      if (card) {
        return card as T;
      } else {
        return undefined;
      }
    },
  );

  @action
  setSearchKey(searchKey: string) {
    this.state.searchKey = searchKey;
    if (!this.state.searchKey) {
      this.resetState();
    } else {
      this.debouncedSearchFieldUpdate();
    }
  }

  debouncedSearchFieldUpdate = debounce(() => this.onSearchFieldUpdated(), 500);

  @action setCardURL(cardURL: string) {
    this.state.selectedCard = undefined;
    this.state.cardURL = cardURL;
  }

  @action setSelectedCard(card: CardDef | undefined) {
    this.state.selectedCard = card;
  }

  @action
  onSearchFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.onSearchFieldUpdated();
    }
  }

  @action
  onSearchFieldUpdated() {
    if (!this.state.searchKey && !this.state.selectedRealms.length) {
      return this.resetState();
    }
    let results: RealmCards[] = [];
    for (let { url, realmInfo, cards } of this.displayedRealms) {
      let filteredCards = cards.filter((c) =>
        c.title
          .trim()
          .toLowerCase()
          .includes(this.state.searchKey.trim().toLowerCase()),
      );
      if (filteredCards.length) {
        results.push({
          url,
          realmInfo,
          cards: filteredCards,
        });
      }
    }
    this.state.searchResults = results;
  }

  @action toggleSelect(card?: CardDef): void {
    this.state.cardURL = '';
    if (this.state.selectedCard?.id === card?.id) {
      this.state.selectedCard = undefined;
      return;
    }
    this.state.selectedCard = card;
  }

  @action pick(card?: CardDef) {
    if (this.request) {
      this.request.deferred.fulfill(card);
    }
    this.stateStack.pop();
  }

  @action createNew(ref: CodeRef) {
    this.createNewTask.perform(ref);
  }

  createNewTask = task(async (ref: CodeRef) => {
    let newCard;
    this.state.dismissModal = true;
    if (this.request?.opts?.createNewCard) {
      newCard = await this.request?.opts?.createNewCard(ref, undefined, {
        isLinkedCard: true,
      });
    } else {
      newCard = await createNewCard(ref, undefined);
    }
    this.pick(newCard);
  });
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
