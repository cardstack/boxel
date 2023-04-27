import { action } from '@ember/object';
import Component from '@glimmer/component';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import SearchSheet, {
  SearchSheetMode,
} from '@cardstack/host/components/search-sheet';
import { restartableTask } from 'ember-concurrency';
import { baseRealm } from '@cardstack/runtime-common';
import type LoaderService from '../services/loader-service';
import { service } from '@ember/service';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { ComponentLike } from '@glint/template';
import { tracked } from '@glimmer/tracking';

import { TrackedArray } from 'tracked-built-ins';

interface Signature {
  Args: {
    firstCardInStack: ComponentLike;
  };
}

export default class OperatorMode extends Component<Signature> {
  @tracked stack: ComponentLike[];
  @service declare loaderService: LoaderService;
  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;

  constructor(owner: unknown, args: any) {
    super(owner, args);

    this.stack = new TrackedArray([this.args.firstCardInStack]);
  }

  @action onFocusSearchInput() {
    if (this.searchSheetMode == SearchSheetMode.Closed) {
      this.searchSheetMode = SearchSheetMode.SearchPrompt;
    }
  }

  @action onCancelSearchSheet() {
    this.searchSheetMode = SearchSheetMode.Closed;
  }

  addToStack(card: CardAPI.Card) {
    this.addCardToStack.perform(card);
  }

  private addCardToStack = restartableTask(async (card: CardAPI.Card) => {
    let api = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`
    );
    let relativeTo = card[api.relativeTo];
    if (!relativeTo) {
      throw new Error(`bug: should never get here`);
    }

    this.stack.push(card.constructor.getComponent(card, 'isolated'));
  });

  <template>
    <div class='operator-mode-desktop-overlay'>
      <CardCatalogModal />
      <CreateCardModal />

      <div class='operator-mode-card-stack'>
        {{#each this.stack as |card|}}
          <div class='operator-mode-stack-card'>
            <card />
          </div>
        {{/each}}
      </div>
      <SearchSheet
        @mode={{this.searchSheetMode}}
        @onCancel={{this.onCancelSearchSheet}}
        @onFocus={{this.onFocusSearchInput}}
      />
    </div>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorMode: typeof OperatorMode;
  }
}
