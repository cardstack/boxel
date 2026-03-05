import { registerDestructor } from '@ember/destroyable';
import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { restartableTask, task } from 'ember-concurrency';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { Button } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';

import type { Loader, CardCatalogQuery } from '@cardstack/runtime-common';
import {
  type CodeRef,
  type CreateNewCard,
  type Filter,
  baseRealm,
  Deferred,
  isCardInstance,
} from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common/query';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '../../utils/text-suggestion';

import SearchPanel from '../card-search/panel';

import ModalContainer from '../modal-container';

import { Submodes } from '../submode-switcher';

import type LoaderService from '../../services/loader-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';
import type RealmServerService from '../../services/realm-server';
import type StoreService from '../../services/store';
import type { NewCardArgs } from '../card-search/utils';

interface Signature {
  Args: {};
}

type Request = {
  deferred: Deferred<string | undefined>;
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
  chooseCardTitle: string;
  dismissModal: boolean;
  errorMessage?: string;
  baseFilter?: Filter;
  availableRealmUrls: string[];
  hasPreselectedCard?: boolean;
  consumingRealm?: URL;
};

const DEFAULT_CHOOOSE_CARD_TITLE = 'Choose a Card';

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{#if this.state}}
      {{! when we "and" these two conditions, the type checks don't seem to work as you'd expect }}
      {{#if (not this.state.dismissModal)}}
        <SearchPanel
          @searchKey={{this.state.searchKey}}
          @baseFilter={{this.state.baseFilter}}
          @availableRealmUrls={{this.state.availableRealmUrls}}
          as |Bar Content|
        >
          <ModalContainer
            class='card-catalog-modal'
            @title={{this.state.chooseCardTitle}}
            @onClose={{this.cancelPick}}
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
              <Bar
                class='card-catalog-search'
                @value={{this.state.searchKey}}
                @onInput={{this.setSearchKey}}
                @placeholder='Search for a card or enter card URL'
              />
            </:header>
            <:content>
              <Content
                @isCompact={{false}}
                @handleSelect={{this.selectFromSearch}}
                @onSubmit={{this.submitFromSearch}}
                @selectedCard={{this.state.selectedCard}}
                @offerToCreate={{this.offerToCreateArg}}
              />
            </:content>
            <:footer>
              <div class='footer'>
                <div>
                  <Button
                    @kind='secondary-light'
                    @size='tall'
                    class='footer-button'
                    {{on 'click' this.cancelPick}}
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
        </SearchPanel>
      {{/if}}
    {{/if}}
    <style scoped>
      .card-catalog-modal > :deep(.boxel-modal__inner) {
        max-height: 80vh;
      }
      .card-catalog-modal.large {
        --boxel-modal-offset-top: var(--boxel-sp-xxxl);
      }
      :deep(.dialog-box__header) {
        gap: var(--boxel-sp);
      }
      :deep(.dialog-box__header),
      :deep(.dialog-box__content) {
        padding-bottom: 0;
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

  private stateStack: State[] = new TrackedArray<State>();
  private stateId = 0;
  @service declare private loaderService: LoaderService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realmServer: RealmServerService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_CHOOSER;
    });
  }

  private get state(): State | undefined {
    return this.stateStack[this.stateStack.length - 1];
  }

  private get offerToCreateArg() {
    if (!this.state) {
      return undefined;
    }
    if (this.operatorModeStateService.state.submode === Submodes.Code) {
      return undefined;
    }
    return this.state.request.opts?.offerToCreate;
  }

  // This is part of our public API for runtime-common to invoke the card chooser
  async chooseCard(
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
      consumingRealm?: URL;
    },
  ): Promise<undefined | string> {
    return await this._chooseCard.perform(
      {
        // default to cardTitle sort so that we can maintain stability in
        // the ordering of the search results (server sorts results
        // by order indexed by default)
        sort: [
          {
            on: {
              module: `${baseRealm.url}card-api`,
              name: 'CardDef',
            },
            by: 'cardTitle',
          },
        ],
        ...query,
      },
      opts,
    );
  }

  private _chooseCard = task(
    async (
      query: CardCatalogQuery,
      opts: {
        offerToCreate?: {
          ref: CodeRef;
          relativeTo: URL | undefined;
          realmURL: URL | undefined;
        };
        multiSelect?: boolean;
        preselectedCardTypeQuery?: Query;
        consumingRealm?: URL;
      } = {},
    ) => {
      await this.realmServer.ready;
      // Preload realm info without blocking the modal from opening.
      let prefetchRealmInfo = Promise.all(
        this.realmServer.availableRealmURLs.map(async (realmURL) => {
          let resource = this.realm.getOrCreateRealmResource(realmURL);
          try {
            await resource.fetchInfo();
          } catch (error) {
            // Keep any existing realm info if the fetch fails; non-fatal for modal.

            console.warn(
              'Failed to fetch realm info for',
              realmURL.toString?.() ?? realmURL,
              error,
            );
          }
        }),
      );
      if (isTesting()) {
        await prefetchRealmInfo;
      } else {
        void prefetchRealmInfo;
      }
      this.stateId++;
      let title = await chooseCardTitle(
        query.filter,
        this.loaderService.loader,
        opts?.multiSelect,
      );
      let request = new TrackedObject<Request>({
        deferred: new Deferred(),
        opts,
      });
      let preselectedCardUrl: string | undefined;
      if (opts?.preselectedCardTypeQuery) {
        let instances: CardDef[] = await this.store.search(
          opts.preselectedCardTypeQuery!,
          this.realmServer.availableRealmURLs,
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
        dismissModal: false,
        baseFilter: query.filter,
        availableRealmUrls: this.realmServer.availableRealmURLs,
        selectedCard: preselectedCardUrl,
        hasPreselectedCard: Boolean(preselectedCardUrl),
        consumingRealm: opts.consumingRealm,
      });
      this.stateStack.push(cardCatalogState);
      return await request.deferred.promise;
    },
  );

  @action
  private setSearchKey(searchKey: string) {
    if (!this.state) {
      return;
    }
    this.state.searchKey = searchKey;
    if (!this.state.searchKey) {
      this.state.selectedCard = undefined;
      this.state.hasPreselectedCard = false;
    }
  }

  @action private selectFromSearch(selection: string | NewCardArgs): void {
    if (!this.state || !selection) {
      return;
    }
    this.state.selectedCard = selection;
    this.state.hasPreselectedCard = false;
  }

  @action private submitFromSearch(selection: string | NewCardArgs): void {
    if (!this.state) {
      return;
    }
    this.state.selectedCard = selection;
    this.pickCard.perform(selection);
  }

  pickCard = restartableTask(
    async (selectedItem?: string | CardDef | NewCardArgs, state?: State) => {
      if (!this.state) {
        return;
      }
      let cardId: string | undefined;
      if (selectedItem) {
        let newCard: NewCardArgs | undefined;
        if (isCardInstance(selectedItem)) {
          cardId = selectedItem.id;
        } else if (typeof selectedItem === 'string') {
          cardId = selectedItem;
        } else {
          newCard = selectedItem;
        }

        if (newCard) {
          cardId = await this.createNewTask.perform(
            newCard.ref,
            newCard.relativeTo ? new URL(newCard.relativeTo) : undefined,
            new URL(newCard.realmURL),
          );
        }
      }

      let request = state ? state.request : this.state.request;
      if (request) {
        request.deferred.fulfill(cardId?.replace(/\.json$/, ''));
      }

      // TODO is this still necessary:
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

  @action private cancelPick() {
    this.pick(undefined, undefined);
  }

  private createNewTask = task(
    async (
      ref: CodeRef,
      relativeTo: URL | undefined /* this should be the spec ID */,
      realmURL: URL | undefined,
    ) => {
      if (!this.state) {
        return;
      }
      let newCardId: string | undefined;
      this.state.dismissModal = true;
      if (this.state.request.opts?.createNewCard) {
        newCardId = await this.state.request.opts?.createNewCard(
          ref,
          relativeTo,
          {
            isLinkedCard: true,
            realmURL,
          },
        );
      } else {
        throw new Error('createNewCard method not provided');
      }
      return newCardId;
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
