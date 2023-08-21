import Component from '@glimmer/component';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import {
  chooseCard,
  catalogEntryRef,
  createNewCard,
} from '@cardstack/runtime-common';
import Directory from './directory';
import { AddButton, Tooltip } from '@cardstack/boxel-ui';
import config from '@cardstack/host/config/environment';
import { OpenFiles } from '@cardstack/host/controllers/code';
const { ownRealmURL } = config;

interface Args {
  Args: {
    url: string;
    openFiles: OpenFiles;
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory
        @openFiles={{@openFiles}}
        @relativePath=''
        @realmURL={{@url}}
      />
    </nav>
    <Tooltip @placement='left'>
      <:trigger>
        <AddButton
          {{on 'click' this.createNew}}
        />
      </:trigger>
      <:content>
        Create a new card
      </:content>
    </Tooltip>
  </template>

  @service declare router: RouterService;

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
          catalogEntryRef,
        )}`,
      );
    }
    let path = `${newCard.id.slice(ownRealmURL.length)}.json`;
    this.args.openFiles.path = path;
  });
}
