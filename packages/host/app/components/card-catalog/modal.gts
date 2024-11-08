import { registerDestructor } from '@ember/destroyable';
import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask, task, timeout } from 'ember-concurrency';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import flatMap from 'lodash/flatMap';

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { Button, BoxelInput } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';

import {
  createNewCard,
  baseRealm,
  type CodeRef,
  type CreateNewCard,
  Deferred,
  Loader,
  RealmInfo,
  CardCatalogQuery,
  isCardInstance,
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

import CardCatalog, { type NewCardArgs } from './index';

import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';
import type RealmServerService from '../../services/realm-server';

interface Signature {
  Args: {};
}

type Request = {
  search: Search;
  deferred: Deferred<CardDef | undefined>;
  opts?: {
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    createNewCard?: CreateNewCard;
  };
};

type State = {
  id: number;
  request: Request;
  selectedCard?: string | NewCardArgs;
  searchKey: string;
  cardUrlFromSearchKey: string;
  chooseCardTitle: string;
  dismissModal: boolean;
  errorMessage?: string;
  query: Query;
  originalQuery: Query; // For purposes of resetting the search
  selectedRealmUrls: string[];
  availableRealmUrls: string[];
  hasPreselectedCard?: boolean;
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
              class='card-catalog-search'
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
                    @selectedCard={{this.state.selectedCard}}
                    @hasPreselectedCard={{this.state.hasPreselectedCard}}
                    @offerToCreate={{unless
                      (eq
                        this.operatorModeStateService.state.submode
                        Submodes.Code
                      )
                      this.state.request.opts.offerToCreate
                    }}
                  />
                {{/if}}
              </:response>
            </PrerenderedCardSearch>
          </:content>
          <:footer>
            <div class='footer'>
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
                  @disabled={{eq this.state.selectedCard undefined}}
                  class='footer-button'
                  {{on
                    'click'
                    (fn this.pick this.state.selectedCard undefined)
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
      .card-catalog-modal :deep(.dialog-box__header) {
        gap: 0;
      }
      .card-catalog-search {
        margin-top: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-sm);
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
    </style>
  </template>

  stateStack: State[] = new TrackedArray<State>();
  stateId = 0;
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realmServer: RealmServerService;
  @service private declare realm: RealmService;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  private get cardUrls() {
    if (!this.state) {
      return [];
    }

    if (this.state.cardUrlFromSearchKey) {
      return [this.state.cardUrlFromSearchKey];
    }
    return [];
  }

  private get availableRealms(): Record<string, RealmInfo> | undefined {
    let items: Record<string, RealmInfo> = {};
    for (let [url, realmMeta] of Object.entries(this.realm.allRealmsInfo)) {
      if (this.state == null || !this.state.availableRealmUrls.includes(url)) {
        continue;
      }
      items[url] = realmMeta.info;
    }
    return items;
  }

  private get state(): State | undefined {
    return this.stateStack[this.stateStack.length - 1];
  }

  @action private onSelectRealm(realmUrl: string) {
    if (!this.state) {
      return;
    }
    this.state.selectedRealmUrls = [...this.state.selectedRealmUrls, realmUrl];
  }

  @action private onDeselectRealm(realmUrl: string) {
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
    this.state.selectedCard = undefined;
    this.state.dismissModal = false;
    this.state.query = this.state.originalQuery;
    this.state.hasPreselectedCard = false;
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard<T extends CardDef>(
    query: CardCatalogQuery,
    opts?: {
      offerToCreate?: {
        ref: CodeRef;
        relativeTo: URL | undefined;
        realmURL: URL | undefined;
      };
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
      preselectedCardTypeQuery?: Query;
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
        offerToCreate?: {
          ref: CodeRef;
          relativeTo: URL | undefined;
          realmURL: URL | undefined;
        };
        multiSelect?: boolean;
        preselectedCardTypeQuery?: Query;
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
      let preselectedCardUrl: string | undefined;
      if (opts?.preselectedCardTypeQuery) {
        let instances: CardDef[] = flatMap(
          await Promise.all(
            this.realmServer.availableRealmURLs.map(
              async (realm) =>
                await this.cardService.search(
                  opts.preselectedCardTypeQuery!,
                  new URL(realm),
                ),
            ),
          ),
        );
        if (instances?.[0]?.id) {
          preselectedCardUrl = `${instances[0].id}.json`;
        }
      }
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
        selectedCard: preselectedCardUrl,
        hasPreselectedCard: Boolean(preselectedCardUrl),
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
  private setSearchKey(searchKey: string) {
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

  private get searchKeyIsURL() {
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

  private debouncedSearchFieldUpdate = restartableTask(async () => {
    await timeout(500);
    this.onSearchFieldUpdated();
  });

  @action
  private onSearchFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.onSearchFieldUpdated();
    }
  }

  @action
  private onSearchFieldUpdated() {
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

  @action private selectCard(
    card?: string | NewCardArgs,
    event?: MouseEvent | KeyboardEvent,
  ): void {
    if (!this.state || !card) {
      return;
    }

    this.state.selectedCard = card;
    this.state.hasPreselectedCard = false;

    if (
      (event instanceof KeyboardEvent && event?.key === 'Enter') ||
      (event instanceof MouseEvent && event?.type === 'dblclick')
    ) {
      this.pickCard.perform(card);
    }
  }

  pickCard = restartableTask(
    async (item?: string | CardDef | NewCardArgs, state?: State) => {
      if (!this.state) {
        return;
      }
      let card: CardDef | undefined;

      if (item) {
        if (isCardInstance(item)) {
          card = item;
        } else if (typeof item === 'string') {
          card = await this.cardService.getCard(item);
        } else {
          card = await this.createNewTask.perform(
            item.ref,
            item.relativeTo ? new URL(item.relativeTo) : undefined,
            new URL(item.realmURL),
          );
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

  @action private handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.pick(undefined);
    }
  }

  @action private pick(item?: string | CardDef | NewCardArgs, state?: State) {
    this.pickCard.perform(item, state);
  }

  private createNewTask = task(
    async (
      ref: CodeRef,
      relativeTo: URL | undefined /* this should be the catalog entry ID */,
      realmURL: URL | undefined,
    ) => {
      if (!this.state) {
        return;
      }
      let newCard;
      this.state.dismissModal = true;
      if (this.state.request.opts?.createNewCard) {
        newCard = await this.state.request.opts?.createNewCard(
          ref,
          relativeTo,
          {
            isLinkedCard: true,
            realmURL,
          },
        );
      } else {
        newCard = await createNewCard(ref, relativeTo, { realmURL });
      }
      return newCard;
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
