import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '../helpers/truth-helpers'
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { chooseCard, catalogEntryRef, createNewCard } from '@cardstack/runtime-common';

interface Args {
  Args: {
    // we want to use the local realm so that we can show a button
    // to open or close it.
    localRealm: LocalRealm;
    path: string | undefined;
  }
}

export default class FileTree extends Component<Args> {
  <template>
    {{#if @localRealm.isAvailable}}
      <button {{on "click" this.closeRealm}} type="button">Close local realm</button>
      {{#each this.listing.entries key="path" as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <div class="item file {{if (eq entry.path @path) 'selected'}} indent-{{entry.indent}}"
            {{on "click" (fn this.open entry)}} role="button">
          {{entry.name}}
          </div>
        {{else}}
          <div class="item directory indent-{{entry.indent}}">
            {{entry.name}}
          </div>
        {{/if}}
      {{/each}}

      <button {{on "click" this.createNew}} type="button" data-test-create-new-card-button>
        Create New Card
      </button>
    {{else if @localRealm.isLoading }}
      ...
    {{else if @localRealm.isEmpty}}
      <button {{on "click" this.openRealm}} type="button">Open a local realm</button>
    {{/if}}
  </template>

  listing = directory(this, () => this.args.localRealm.isAvailable ? "http://local-realm/" : undefined)
  @service declare router: RouterService;

  @action
  openRealm() {
    this.args.localRealm.chooseDirectory(() => this.router.refresh());
  }

  @action
  closeRealm() {
    if (this.args.localRealm.isAvailable) {
      this.args.localRealm.close();
      this.router.transitionTo({ queryParams: { path: undefined } });
    }
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
