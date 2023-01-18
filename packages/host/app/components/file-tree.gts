import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import type CardService from '../services/card-service';
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
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

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
      {{#each this.listing.entries key="path" as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <File @realmPath={{this.realmPath}} @entry={{entry}} @path="{{this.realmPath.url}}{{entry.path}}" />
        {{else}}
          <div role="button" {{on "click" (fn this.toggleOpen entry)}} class="directory indent-{{entry.indent}}">
            {{entry.name}}
          </div>
          <Directory @realmPath={{this.realmPath}} @polling={{@polling}} @directory={{entry}} @url={{this.args.url}} @openDirs={{@openDirs}} />
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

  listing = directory(this, () => this.args.url, () => this.args.openDirs, () => this.args.polling);
  @service declare router: RouterService;
  @service declare cardService: CardService;
  @tracked isPolling = this.args.polling !== 'off';

  @cached
  get realmPath() {
    return new RealmPaths(this.cardService.defaultURL.href);
  }

  get openDirs() {
    if (!this.args.openDirs) {
      return [];
    }
    return this.args.openDirs.includes(',') ? this.args.openDirs.split(',') : [ this.args.openDirs ];
  }

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
    let queryPath: string | undefined;
    let dirURL = this.realmPath.directoryURL(entry.path);
    let localPath = this.realmPath.local(dirURL);
    if (!this.args.openDirs || this.openDirs.length === 0) {
      queryPath = localPath;
    } else if (!this.args.openDirs.includes(entry.path)) {
      queryPath = [...this.openDirs, localPath].join(',');
    } else {
      let dirArr: string[] = [];
      for (let dirPath of this.openDirs) {
        if (localPath.startsWith(dirPath) || dirPath.startsWith(localPath)) {
          let dirParts = dirPath.split('/');
          let i = dirParts.indexOf(entry.path);
          if (i === -1) {
            dirParts = [...dirParts, entry.path];
            dirArr.push(dirParts.join('/'));
          } else {
            dirPath = dirParts.slice(0, i).join('/');
            if (dirPath.length > 0) {
              dirArr.push(dirPath);
            }
          }
        } else {
          dirArr.push(dirPath);
        }
      }
      queryPath = dirArr.length ? dirArr.join(',') : undefined;
    }
    this.router.transitionTo({ queryParams: { openDirs: queryPath } });
  }
}
