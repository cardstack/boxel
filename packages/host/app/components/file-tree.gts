import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { chooseCard, catalogEntryRef, createNewCard } from '@cardstack/runtime-common';
import { directory, type Entry } from '../resources/directory';
import Directory from './directory';
import ClosedDirectory from './closed-directory';
import File from './file';

interface Args {
  Args: {
    url: string;
    path: string | undefined;
    openDirs: string | undefined;
    polling: 'off' | undefined;
  }
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory
        @openDirs={{if @openDirs @openDirs ""}}
        @path={{@path}}
        @polling={{@polling}}
        @url={{@url}}
      />
    </nav>
    <button {{on "click" this.createNew}} type="button" data-test-create-new-card-button>
      Create New Card
    </button>
    <div>
      <button {{on "click" this.togglePolling}}>{{if this.isPolling "Stop" "Start"}} Polling</button>
      {{#unless this.isPolling}}<p><strong>Status: Polling is off!</strong></p>{{/unless}}
    </div>
  </template>

  listing = directory(this, () => this.args.url, () => this.args.openDirs, () => this.args.polling );
  @service declare router: RouterService;
  @tracked isPolling = this.args.polling !== 'off';

  @action
  togglePolling() {
    this.router.transitionTo({ queryParams: { polling: this.isPolling ? 'off' : undefined } });
    this.isPolling = !this.isPolling;
  }

  @action
  openFile(entry: Entry) {
    let { path } = entry;
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  openDirectory(entry: Entry) {
    let dirs = this.args.openDirs ? this.args.openDirs.split(',') : [];
    let openDirs = [...dirs, entry.path].join(',');
    this.router.transitionTo({ queryParams: { openDirs } });
  }

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
}

function isOpen(path: string, openDirs: string | undefined) {
  return openDirs?.includes(path);
}
