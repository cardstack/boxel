import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { eq } from '../helpers/truth-helpers'
import { directory, Entry } from '../resources/directory';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { chooseCard, catalogEntryRef, createNewCard } from '@cardstack/runtime-common';

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
          <div role="button" {{on "click" (fn this.open entry)}} class="file {{if (eq entry.path @path) "selected"}} indent-{{entry.indent}}">
          {{entry.name}}
          </div>
        {{else}}
          <div class="directory indent-{{entry.indent}}">
            {{entry.name}}
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
  open(entry: Entry) {
    let { path } = entry;
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  onSave(path: string) {
    this.router.transitionTo({ queryParams: { path } });
  }
}
