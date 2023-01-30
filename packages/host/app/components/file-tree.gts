import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import type MessageService from '../services/message-service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { chooseCard, catalogEntryRef, createNewCard } from '@cardstack/runtime-common';
import Directory from './directory';

interface Args {
  Args: {
    url: string;
    path: string | undefined;
    openDirs: string | undefined;
  }
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory
        @openDirs={{@openDirs}}
        @path={{@path}}
        @url={{@url}}
      />
    </nav>
    <button {{on "click" this.createNew}} type="button" data-test-create-new-card-button>
      Create New Card
    </button>
    <div> {{!-- TODO: Remove this block --}}
      <button {{on "click" this.startSSE}}>Start</button>
      <button {{on "click" this.stopSSE}}>Stop</button>
    </div>
  </template>

  @service declare router: RouterService;
  @service declare messageService: MessageService;

  @action
  async createNew() {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isPrimitive: false },
      }
    });
    if (!card) {
      return;
    }
    return await createNewCard(card.ref);
  }

  // TODO: Remove these
  @action startSSE() {
    this.messageService.start();
  }
  @action stopSSE() {
    this.messageService.stop();
  }
}
