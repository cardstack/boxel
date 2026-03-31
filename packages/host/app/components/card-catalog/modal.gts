import { registerDestructor } from '@ember/destroyable';
import { array, fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { restartableTask, task } from 'ember-concurrency';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import pluralize from 'pluralize';

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
  deferred: Deferred<string[] | undefined>;
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
  selectedCards: (string | NewCardArgs)[];
  multiSelect: boolean;
  searchKey: string;
  chooseCardTitle: string;
  dismissModal: boolean;
  errorMessage?: string;
  baseFilter?: Filter;
  availableRealmUrls: string[];
  hasPreselectedCard?: boolean;
  consumingRealm?: URL;
};

function isNewCardArgs(item: string | NewCardArgs): item is NewCardArgs {
  return typeof item !== 'string' && 'realmURL' in item;
}

function normalizeCardUrl(url: string): string {
  return url.replace(/\.json$/, '');
}

function selectionEquals(
  a: string | NewCardArgs,
  b: string | NewCardArgs,
): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return normalizeCardUrl(a) === normalizeCardUrl(b);
  }
  if (isNewCardArgs(a) && isNewCardArgs(b)) {
    return a.realmURL === b.realmURL;
  }
  return false;
}

const DEFAULT_CHOOOSE_CARD_TITLE = 'Choose a Card';

export default class CardCatalogModal extends Component<Signature> {
  <template>
    {{#if this.state}}
      {{! when we "and" these two conditions, the type checks don't seem to work as you'd expect }}
      {{#if (not this.state.dismissModal)}}
        {{#each (array this.state) key='id' as |state|}}
          <SearchPanel
            @searchKey={{state.searchKey}}
            @baseFilter={{state.baseFilter}}
            @availableRealmUrls={{state.availableRealmUrls}}
            @consumingRealm={{state.consumingRealm}}
            as |Bar Content|
          >
            <ModalContainer
              class='card-catalog-modal'
              @title={{state.chooseCardTitle}}
              @onClose={{this.cancelPick}}
              @layer='urgent'
              {{focusTrap
                isActive=(not state.dismissModal)
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
                  @value={{state.searchKey}}
                  @onInput={{this.setSearchKey}}
                  @placeholder='Search for a card or enter card URL'
                />
              </:header>
              <:content>
                <Content
                  @isCompact={{false}}
                  @handleSelect={{this.selectFromSearch}}
                  @onSubmit={{this.submitFromSearch}}
                  @selectedCards={{state.selectedCards}}
                  @multiSelect={{state.multiSelect}}
                  @onSelectAll={{this.selectAll}}
                  @onDeselectAll={{this.deselectAll}}
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
                      @disabled={{eq state.selectedCards.length 0}}
                      class='footer-button'
                      {{on 'click' (fn this.pickCards state)}}
                      data-test-card-catalog-go-button
                    >
                      {{this.goButtonText}}
                    </Button>
                  </div>
                </div>
              </:footer>
            </ModalContainer>
          </SearchPanel>
        {{/each}}
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

  private get goButtonText(): string {
    if (!this.state?.multiSelect) {
      return 'Go';
    }
    const count = this.state.selectedCards.length;
    return `Choose ${count} ${pluralize('Card', count)}`;
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
      preselectedCardUrls?: string[];
    },
  ): Promise<undefined | string | string[]> {
    let result = await this._chooseCard.perform(
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
    if (opts?.multiSelect) {
      return result;
    }
    return result?.[0];
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
        preselectedCardUrls?: string[];
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
      let preselectedCardUrls = (
        opts?.preselectedCardUrls?.length
          ? opts.preselectedCardUrls
          : preselectedCardUrl
            ? [preselectedCardUrl]
            : []
      ).map((url) => (url.endsWith('.json') ? url : `${url}.json`));

      let cardCatalogState = new TrackedObject<State>({
        id: this.stateId,
        request,
        chooseCardTitle: title,
        searchKey: '',
        dismissModal: false,
        baseFilter: query.filter,
        availableRealmUrls: this.realmServer.availableRealmURLs,
        selectedCards: preselectedCardUrls,
        multiSelect: opts?.multiSelect ?? false,
        hasPreselectedCard: preselectedCardUrls.length > 0,
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
      this.state.selectedCards = [];
      this.state.hasPreselectedCard = false;
    }
  }

  @action private selectFromSearch(selection: string | NewCardArgs): void {
    if (!this.state || !selection) {
      return;
    }
    if (this.state.multiSelect) {
      // Toggle: add if absent, remove if present
      const idx = this.state.selectedCards.findIndex((s) =>
        selectionEquals(s, selection),
      );
      if (idx >= 0) {
        this.state.selectedCards = this.state.selectedCards.filter(
          (_, i) => i !== idx,
        );
      } else {
        this.state.selectedCards = [...this.state.selectedCards, selection];
      }
    } else {
      // Single-select: replace
      this.state.selectedCards = [selection];
    }
    this.state.hasPreselectedCard = false;
  }

  @action private submitFromSearch(selection: string | NewCardArgs): void {
    if (!this.state) {
      return;
    }
    if (this.state.multiSelect && typeof selection === 'string') {
      // In multi-select, double-click on existing cards just toggles (don't submit)
      this.selectFromSearch(selection);
      return;
    }
    this.state.selectedCards = [selection];
    this.pickCards(this.state);
  }

  @action private selectAll(cards: string[]): void {
    if (!this.state) {
      return;
    }
    this.state.selectedCards = [...cards];
  }

  @action private deselectAll(): void {
    if (!this.state) {
      return;
    }
    this.state.selectedCards = [];
  }

  @action private pickCards(state?: State) {
    this.pickCard.perform(state);
  }

  pickCard = restartableTask(async (state?: State) => {
    let currentState = state ?? this.state;
    if (!currentState) {
      return;
    }

    let cardIds: string[] = [];
    for (let selectedItem of currentState.selectedCards) {
      if (typeof selectedItem === 'string') {
        cardIds.push(selectedItem.replace(/\.json$/, ''));
      } else {
        // NewCardArgs — create the card
        let newCardId = await this.createNewTask.perform(
          selectedItem.ref,
          selectedItem.relativeTo
            ? new URL(selectedItem.relativeTo)
            : undefined,
          new URL(selectedItem.realmURL),
        );
        if (newCardId) {
          cardIds.push(newCardId.replace(/\.json$/, ''));
        }
      }
    }

    let request = currentState.request;
    if (request) {
      request.deferred.fulfill(cardIds.length > 0 ? cardIds : undefined);
    }

    // Remove state from stack
    let stateIndex = this.stateStack.findIndex(
      (s) => s.id === currentState!.id,
    );
    if (stateIndex >= 0) {
      this.stateStack.splice(stateIndex, 1);
    }
  });

  @action private handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.cancelPick();
    }
  }

  @action private cancelPick() {
    if (!this.state) {
      return;
    }
    let request = this.state.request;
    if (request) {
      request.deferred.fulfill(undefined);
    }
    this.stateStack.pop();
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
