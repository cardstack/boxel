import Component from '@glimmer/component';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import type RouterService from '@ember/routing/router-service';
import type LoaderService from '../services/loader-service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import {
  chooseCard,
  catalogEntryRef,
  createNewCard,
  baseRealm,
} from '@cardstack/runtime-common';
import Directory from './directory';
import { IconButton } from '@cardstack/boxel-ui';

interface Args {
  Args: {
    url: string;
    openFile: string | undefined;
    openDirs: string[];
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory
        @openDirs={{@openDirs}}
        @openFile={{@openFile}}
        @relativePath=''
        @realmURL={{@url}}
      />
    </nav>
    <IconButton
      @icon='icon-plus-circle'
      @width='40px'
      @height='40px'
      @tooltip='Create a new card'
      class='add-button'
      {{on 'click' this.createNew}}
      data-test-create-new-card-button
    />
  </template>

  @service declare router: RouterService;
  @service declare loaderService: LoaderService;

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
    let path = `${newCard.id.slice(relativeTo.href.length)}.json`;
    this.router.transitionTo('code', { queryParams: { path } });
  });
}
