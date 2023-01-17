import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory, Entry } from '../resources/directory';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { chooseCard, catalogEntryRef, createNewCard, RealmPaths } from '@cardstack/runtime-common';
import File from './file';
import Directory from './directory';

interface Args {
  Args: {
    url: string;
    path: string | undefined;
    openDirs: string | undefined;
    polling: 'off' | undefined;
  }
}

function localPath(url: string, path: string) {
  let realmPaths = new RealmPaths(url);
  let dirURL = realmPaths.directoryURL(path);
  return realmPaths.local(dirURL);
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      {{#each this.listing.entries key="path" as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <File @entry={{entry}} @path={{localPath this.args.url entry.path}} />
        {{else}}
          <div role="button" {{on "click" (fn this.toggleOpen entry)}} class="directory indent-{{entry.indent}}">
            {{entry.name}}
            <Directory @polling={{@polling}} @directory={{entry}} @url={{this.args.url}} @openDirs={{@openDirs}} />
          </div>
        {{/if}}
      {{/each}}
    </nav>
    <button {{on "click" this.createNew}} type="button" data-test-create-new-card-button>
      Create New Card
    </button>
    <div>
      <button {{on "click" this.togglePolling}}>{{if this.isPolling "Stop" "Start"}} Polling</button>
      {{#unless this.isPolling}}<p><strong>Status: Polling is off!</strong></p>{{/unless}}
    </div>
  </template>

  @tracked listing = directory(this, () => this.args.url, () => this.args.openDirs, () => this.args.polling);
  @service declare router: RouterService;
  @tracked isPolling = this.args.polling !== 'off';

  @action
  togglePolling() {
    this.router.transitionTo({ queryParams: { polling: this.isPolling ? 'off' : undefined } });
    this.isPolling = !this.isPolling;
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

  @action
  toggleOpen(entry: Entry) {
    this.router.transitionTo({ queryParams: { openDirs: entry.path } });
  }
}
