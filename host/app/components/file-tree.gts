import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';
import { eq } from '../helpers/truth-helpers'
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import CreateNew from './create-new';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

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
      <button {{on "click" this.closeRealm}}>Close local realm</button>
      {{#each this.listing.entries key="path" as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <div class="item file {{if (eq entry.path @path) 'selected'}} indent-{{entry.indent}}"
            {{on "click" (fn this.open entry)}}>
          {{entry.name}}
          </div>
        {{else}}
          <div class="item directory indent-{{entry.indent}}">
            {{entry.name}}
          </div>
        {{/if}}
      {{/each}}
      <button {{on "click" this.openCatalog}} type="button">Create New Card</button>
      {{#if this.isCatalogOpen}}
        {{!-- template-lint-disable no-inline-styles --}}
        <dialog style="position:absolute;z-index:1;top:10vh;" open>
          <button {{on "click" this.closeCatalog}} type="button">X Close</button>
          <CreateNew @realmURL={{@localRealm.url.href}} @onSave={{this.onSave}} />
        </dialog>
      {{/if}}
    {{else if @localRealm.isLoading }}
      ...
    {{else if @localRealm.isEmpty}}
      <button {{on "click" this.openRealm}}>Open a local realm</button>
    {{/if}}
  </template>

  listing = directory(this, () => this.args.localRealm.isAvailable ? "http://local-realm/" : undefined)
  @service declare router: RouterService;
  @tracked isCatalogOpen = false;

  @cached
  get realmPath() {
    if (!this.args.localRealm.isAvailable) {
      throw new Error('Realm is not available');
    }
    return new RealmPaths(Loader.reverseResolution(this.args.localRealm.url.href));
  }

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
  open(entry: Entry) {
    let { path } = entry;
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  openCatalog() {
    this.isCatalogOpen = true;
  }

  @action
  onSave(url: string) {
    let path = this.realmPath.local(new URL(url));
    this.router.transitionTo({ queryParams: { path } });
    this.closeCatalog();
  }

  @action
  closeCatalog() {
    this.isCatalogOpen = false;
  }
}
