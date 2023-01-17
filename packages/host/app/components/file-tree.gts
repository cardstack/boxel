import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { eq, and } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory, Entry, type DirectoryResource } from '../resources/directory';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { chooseCard, catalogEntryRef, createNewCard, RealmPaths } from '@cardstack/runtime-common';
import File from './file';

interface Args {
  Args: {
    url: string;
    path: string | undefined;
    polling: 'off' | undefined;
  }
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      {{#each this.listing.entries key="path" as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <File @entry={{entry}} @url={{this.listing.url}} />
          {{!-- <div role="button" {{on "click" (fn this.open entry this.listing.url)}} class="file {{if (eq entry.path @path) "selected"}} indent-{{entry.indent}}">
          {{entry.name}}
          </div> --}}
        {{else}}
          <div role="button" {{on "click" (fn this.openDirectory entry)}} class="directory indent-{{entry.indent}}">
            {{entry.name}}
            {{#if (and (eq this.currentDir entry.name) this.results.entries.length)}}
              {{#each this.results.entries as |subEntry|}}
                <File @entry={{subEntry}} @url={{this.results.url}} />
              {{/each}}
            {{/if}}
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

  listing = directory(this, () => this.args.url, () => this.args.polling);
  @service declare router: RouterService;
  @tracked isPolling = this.args.polling !== 'off';
  @tracked results: DirectoryResource | undefined;
  @tracked currentDir: string | undefined;

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
  open(entry: Entry, url: string) {
    let { path } = entry;
    console.log(url + path);
    this.router.transitionTo({ queryParams: { path: url + path } });
  }

  @action
  onSave(path: string) {
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  openDirectory(entry: Entry) {
    let { path } = entry;
    let realmPaths = new RealmPaths(this.args.url);
    let url = realmPaths.directoryURL(path);
    let inner = directory(this, () => url.href, () => this.args.polling);
    console.log(inner);
    this.results = inner;
    this.currentDir = entry.name;
  }
}
