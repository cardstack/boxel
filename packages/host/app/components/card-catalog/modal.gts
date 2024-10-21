import { registerDestructor } from '@ember/destroyable';
import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask, task, timeout } from 'ember-concurrency';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { Button, BoxelInput } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import {
  createNewCard,
  baseRealm,
  type CodeRef,
  type CreateNewCard,
  Deferred,
  Loader,
  RealmInfo,
  CardCatalogQuery,
} from '@cardstack/runtime-common';

import type {
  Query,
  Filter,
  EveryFilter,
  CardTypeFilter,
} from '@cardstack/runtime-common/query';

import {
  isCardTypeFilter,
  isEveryFilter,
} from '@cardstack/runtime-common/query';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';
import RealmServerService from '@cardstack/host/services/realm-server';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { getSearchResults, Search } from '../../resources/search';

import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '../../utils/text-suggestion';

import ModalContainer from '../modal-container';

import PrerenderedCardSearch from '../prerendered-card-search';

import { Submodes } from '../submode-switcher';

import CardCatalogFilters from './filters';

import CardCatalog from './index';

import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';

interface Signature {
  Args: {};
}

type Request = {
  search: Search;
  deferred: Deferred<CardDef | undefined>;
  opts?: {
    offerToCreate?: { ref: CodeRef; relativeTo: URL | undefined };
    createNewCard?: CreateNewCard;
  };
};

type State = {
  id: number;
  request: Request;
  selectedCardUrl?: string;
  searchKey: string;
  cardUrlFromSearchKey: string;
  chooseCardTitle: string;
  dismissModal: boolean;
  errorMessage?: string;
  query: Query;
  originalQuery: Query; // For purposes of resetting the search
  selectedRealmUrls: string[];
  availableRealmUrls: string[];
};

const DEFAULT_CHOOOSE_CARD_TITLE = 'Choose a Card';

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{#if this.state}}
      {{! when we "and" these two conditions, the type checks don't seem to work as you'd expect }}
      {{#if (not this.state.dismissModal)}}
        <ModalContainer
          class='card-catalog-modal'
          @title={{this.state.chooseCardTitle}}
          @onClose={{fn this.pick undefined}}
          @layer='urgent'
          {{focusTrap
            isActive=(not this.state.dismissModal)
            focusTrapOptions=(hash
              initialFocus='[data-test-search-field]' allowOutsideClick=true
            )
          }}
          {{on 'keydown' this.handleKeydown}}
          data-test-card-catalog-modal
        >
          <:header>
            <BoxelInput
              @type='search'
              @variant='large'
              @value={{this.state.searchKey}}
              @onInput={{this.setSearchKey}}
              @onKeyPress={{this.onSearchFieldKeypress}}
              @placeholder='Search for a card or enter card URL'
              data-test-search-field
            />
            <CardCatalogFilters
              @availableRealms={{this.availableRealms}}
              @selectedRealmUrls={{this.state.selectedRealmUrls}}
              @onSelectRealm={{this.onSelectRealm}}
              @onDeselectRealm={{this.onDeselectRealm}}
              @disableRealmFilter={{this.searchKeyIsURL}}
            />
          </:header>
          <:content>
            <PrerenderedCardSearch
              @query={{this.state.query}}
              @format='fitted'
              @realms={{this.state.selectedRealmUrls}}
              @cardUrls={{this.cardUrls}}
            >
              <:loading>
                Loading...
              </:loading>
              <:response as |cards|>
                {{#if this.availableRealms}}
                  <CardCatalog
                    @cards={{cards}}
                    @realmInfos={{this.availableRealms}}
                    @select={{this.selectCard}}
                    @selectedCardUrl={{this.state.selectedCardUrl}}
                  />
                {{/if}}
              </:response>
            </PrerenderedCardSearch>
          </:content>
          <:footer>
            <div class='footer'>
              <div class='footer__actions-left'>
                {{#if this.state.request.opts.offerToCreate}}
                  {{#unless
                    (eq
                      this.operatorModeStateService.state.submode Submodes.Code
                    )
                  }}
                    <Button
                      @kind='secondary-light'
                      @size='tall'
                      class='create-new-button'
                      {{on
                        'click'
                        (fn
                          this.createNew
                          this.state.request.opts.offerToCreate.ref
                          this.state.request.opts.offerToCreate.relativeTo
                        )
                      }}
                      data-test-card-catalog-create-new-button
                    >
                      <IconPlus width='20' height='20' role='presentation' />
                      Create New
                      {{this.cardRefName}}
                    </Button>
                  {{/unless}}
                {{/if}}
              </div>
              <div>
                <Button
                  @kind='secondary-light'
                  @size='tall'
                  class='footer-button'
                  {{on 'click' (fn this.pick undefined undefined)}}
                  data-test-card-catalog-cancel-button
                >
                  Cancel
                </Button>
                <Button
                  @kind='primary'
                  @size='tall'
                  @disabled={{eq this.state.selectedCardUrl undefined}}
                  class='footer-button'
                  {{on
                    'click'
                    (fn this.pick this.state.selectedCardUrl undefined)
                  }}
                  data-test-card-catalog-go-button
                >
                  Go
                </Button>
              </div>
            </div>
          </:footer>
        </ModalContainer>
      {{/if}}
    {{/if}}
    <style scoped>
      .card-catalog-modal > :deep(.boxel-modal__inner) {
        max-height: 80vh;
      }
      .card-catalog-modal.large {
        --boxel-modal-offset-top: var(--boxel-sp-xxxl);
      }
      .footer {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp);
        margin-left: auto;
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
  stateId = 0;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare realmServer: RealmServerService;
  @service declare realm: RealmService;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  get cardUrls() {
    if (!this.state) {
      return [];
    }

    if (this.state.cardUrlFromSearchKey) {
      return [this.state.cardUrlFromSearchKey];
    }
    return [];
  }

  get availableRealms(): Record<string, RealmInfo> | undefined {
    let items: Record<string, RealmInfo> = {};
    for (let [url, realmMeta] of Object.entries(this.realm.allRealmsInfo)) {
      if (this.state == null || !this.state.availableRealmUrls.includes(url)) {
        continue;
      }
      items[url] = realmMeta.info;
    }
    return items;
  }

  get cardRefName() {
    if (!this.state) {
      return undefined;
    }
    return (
      (
        this.state.request.opts?.offerToCreate?.ref as {
          module: string;
          name: string;
        }
      ).name ?? 'Card'
    );
  }

  get state(): State | undefined {
    return this.stateStack[this.stateStack.length - 1];
  }

  @action onSelectRealm(realmUrl: string) {
    if (!this.state) {
      return;
    }
    this.state.selectedRealmUrls = [...this.state.selectedRealmUrls, realmUrl];
  }

  @action onDeselectRealm(realmUrl: string) {
    if (!this.state) {
      return;
    }

    this.state.selectedRealmUrls = this.state.selectedRealmUrls.filter(
      (r) => r !== realmUrl,
    );
  }

  private resetState() {
    if (!this.state) {
      return;
    }
    this.state.searchKey = '';
    this.state.cardUrlFromSearchKey = '';
    this.state.selectedCardUrl = undefined;
    this.state.dismissModal = false;
    this.state.query = this.state.originalQuery;
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard<T extends CardDef>(
    query: CardCatalogQuery,
    opts?: {
      offerToCreate?: { ref: CodeRef; relativeTo: URL | undefined };
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
    },
  ): Promise<undefined | T> {
    return (await this._chooseCard.perform(
      {
        // default to title sort so that we can maintain stability in
        // the ordering of the search results (server sorts results
        // by order indexed by default)
        sort: [
          {
            on: {
              module: `${baseRealm.url}card-api`,
              name: 'CardDef',
            },
            by: 'title',
          },
        ],

        ...query,
      },
      opts,
    )) as T | undefined;
  }

  private _chooseCard = task(
    async <T extends CardDef>(
      query: CardCatalogQuery,
      opts: {
        offerToCreate?: { ref: CodeRef; relativeTo: URL | undefined };
        multiSelect?: boolean;
      } = {},
    ) => {
      this.stateId++;
      let title = await chooseCardTitle(
        query.filter,
        this.loaderService.loader,
        opts?.multiSelect,
      );
      let request = new TrackedObject<Request>({
        search: getSearchResults(this, query),
        deferred: new Deferred(),
        opts,
      });
      let cardCatalogState = new TrackedObject<State>({
        id: this.stateId,
        request,
        chooseCardTitle: title,
        searchKey: '',
        cardUrlFromSearchKey: '',
        dismissModal: false,
        query,
        originalQuery: query,
        availableRealmUrls: this.realmServer.availableRealmURLs,
        selectedRealmUrls: this.realmServer.availableRealmURLs,
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
    if (!this.state) {
      return;
    }
    this.state.searchKey = searchKey;
    if (!this.state.searchKey) {
      this.resetState();
    } else {
      this.debouncedSearchFieldUpdate.perform();
    }
  }

  get searchKeyIsURL() {
    if (!this.state) {
      return false;
    }
    try {
      new URL(this.state.searchKey);
      return true;
    } catch (_e) {
      return false;
    }
  }

  debouncedSearchFieldUpdate = restartableTask(async () => {
    await timeout(500);
    this.onSearchFieldUpdated();
  });

  @action
  onSearchFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.onSearchFieldUpdated();
    }
  }

  @action
  onSearchFieldUpdated() {
    if (!this.state) {
      return;
    }

    this.state.errorMessage = '';

    if (!this.state.searchKey) {
      return this.resetState();
    }

    let searchKeyIsURL = this.searchKeyIsURL;
    if (searchKeyIsURL) {
      // This is when a user has entered a URL directly into the search field
      // 1. if .json is missing, add it
      // 2. if the URL points to a realm, add /index.json for convenience of  getting the index card
      this.state.query = this.state.originalQuery;
      let cardUrlFromSearchKey = this.state.searchKey;

      if (
        this.state.availableRealmUrls.some(
          (url) =>
            url === cardUrlFromSearchKey || url === cardUrlFromSearchKey + '/',
        )
      ) {
        cardUrlFromSearchKey = cardUrlFromSearchKey.endsWith('/')
          ? cardUrlFromSearchKey + 'index'
          : cardUrlFromSearchKey + '/index';
      }
      this.state.cardUrlFromSearchKey =
        cardUrlFromSearchKey +
        (cardUrlFromSearchKey.endsWith('.json') ? '' : '.json');
      return;
    }

    let newFilter: EveryFilter | undefined;

    if (this.state.originalQuery.filter) {
      let _isCardTypeFilter = isCardTypeFilter(this.state.originalQuery.filter);
      let _isEveryFilter = isEveryFilter(this.state.originalQuery.filter);

      if (_isCardTypeFilter) {
        newFilter = {
          on: (this.state.originalQuery.filter as CardTypeFilter).type,
          every: [{ contains: { title: this.state.searchKey } }],
        };
      } else if (_isEveryFilter) {
        newFilter = {
          ...(this.state.originalQuery.filter as EveryFilter),
          every: [
            ...(this.state.originalQuery.filter as EveryFilter).every,
            { contains: { title: this.state.searchKey } },
          ],
        };
      } else {
        // We demand either CardTypeFilter or EveryFilter so it's straightforward to add the "contains" filter (in addition to the existing filters)
        throw new Error(
          'Unsupported card chooser filter type: needs to be either card type filter or "every" filter',
        );
      }
    }
    if (newFilter) {
      this.state.query = { ...this.state.query, filter: newFilter };
    }
  }

  @action selectCard(
    cardUrl?: string,
    event?: MouseEvent | KeyboardEvent,
  ): void {
    if (!this.state || !cardUrl) {
      return;
    }

    this.state.selectedCardUrl = cardUrl;

    if (
      (event instanceof KeyboardEvent && event?.key === 'Enter') ||
      (event instanceof MouseEvent && event?.type === 'dblclick')
    ) {
      this.pickCard.perform(cardUrl);
    }
  }

  pickCard = restartableTask(
    async (cardUrlOrCardDef?: string | CardDef, state?: State) => {
      if (!this.state) {
        return;
      }
      let card: CardDef | undefined;

      if (cardUrlOrCardDef) {
        let isCardDef = typeof cardUrlOrCardDef !== 'string';
        if (isCardDef) {
          card = cardUrlOrCardDef as CardDef;
        } else {
          card = await this.cardService.getCard(cardUrlOrCardDef as string);
        }
      }

      let request = state ? state.request : this.state.request;
      if (request) {
        request.deferred.fulfill(card);
      }

      // In the 'createNewCard' case, auto-save doesn't follow any specific order,
      // so we cannot guarantee that the outer 'createNewCard' process (the top item in the stack) will be saved before the inner one.
      // That's why we use state ID to remove state from the stack.
      if (state) {
        let stateIndex = this.stateStack.findIndex((s) => s.id === state.id);
        this.stateStack.splice(stateIndex, 1);
      } else {
        this.stateStack.pop();
      }
    },
  );

  @action handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.pick(undefined);
    }
  }

  @action pick(cardUrlOrCardDef?: string | CardDef, state?: State) {
    this.pickCard.perform(cardUrlOrCardDef, state);
  }

  @action createNew(ref: CodeRef, relativeTo: URL | undefined) {
    this.createNewTask.perform(ref, relativeTo);
  }

  createNewTask = task(
    async (
      ref: CodeRef,
      relativeTo: URL | undefined /* this should be the catalog entry ID */,
    ) => {
      if (!this.state) {
        return;
      }
      let newCard;
      this.state.dismissModal = true;

      // We need to store the current state in a variable
      // because there is a possibility that in createNewCard,
      // users will open the card catalog modal and insert a new state into the stack.
      let currentState = this.state;
      if (this.state.request.opts?.createNewCard) {
        newCard = await this.state.request.opts?.createNewCard(
          ref,
          relativeTo,
          {
            isLinkedCard: true,
          },
        );
      } else {
        newCard = await createNewCard(ref, relativeTo);
      }
      this.pick(newCard, currentState);
    },
  );
}

async function chooseCardTitle(
  filter: Filter | undefined,
  loader: Loader,
  multiSelect?: boolean,
): Promise<string> {
  if (!filter) {
    return DEFAULT_CHOOOSE_CARD_TITLE;
  }
  let suggestions = await suggestCardChooserTitle(filter, 0, {
    loader,
    multiSelect,
  });
  return (
    getSuggestionWithLowestDepth(suggestions) ?? DEFAULT_CHOOOSE_CARD_TITLE
  );
}
