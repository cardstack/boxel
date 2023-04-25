import { action } from '@ember/object';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import { restartableTask } from 'ember-concurrency';
import {
  chooseCard,
  catalogEntryRef,
  createNewCard,
  baseRealm,
} from '@cardstack/runtime-common';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import type LoaderService from '../services/loader-service';
import { service } from '@ember/service';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { ComponentLike } from '@glint/template';
import { tracked } from '@glimmer/tracking';

interface Signature {
  Args: {
    firstCardInStack: ComponentLike;
  };
}

export default class OperatorMode extends Component<Signature> {
  @tracked stack: ComponentLike[];
  @service declare loaderService: LoaderService;
  constructor(owner: unknown, args: any) {
    super(owner, args);

    this.stack = [this.args.firstCardInStack];
  }

  @action
  async createNew() {
    this.createNewCard.perform();
  }

  private createNewCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isPrimitive: false },
      },
    });
    if (!card) {
      return;
    }
    let newCard = await createNewCard(card.ref, new URL(card.id));
    if (!newCard) {
      throw new Error(
        `bug: could not create new card from catalog entry ${JSON.stringify(
          catalogEntryRef
        )}`
      );
    }
    let api = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`
    );
    let relativeTo = newCard[api.relativeTo];
    if (!relativeTo) {
      throw new Error(`bug: should never get here`);
    }

    this.stack = [
      ...this.stack,
      newCard.constructor.getComponent(newCard, 'isolated'),
    ];
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

          <br />
          <br />
        {{/each}}

        <div>
          <br />

          <Button @kind='primary' @size='tall' {{on 'click' this.createNew}}>
            ➕ Add a new card to this collection
          </Button>
        </div>
      </div>
    </div>
  </template>
}
