import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';
import { eq } from '../helpers/truth-helpers'
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

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
          <div class="item file {{if (eq entry.path this.args.path) 'selected'}} indent-{{entry.indent}}"
            {{on "click" (fn this.open entry)}}>
          {{entry.name}}
          </div>
        {{else}}
          <div class="item directory indent-{{entry.indent}}">
            {{entry.name}}
          </div>
        {{/if}}
      {{/each}}
    {{else if @localRealm.isLoading }}
      ...
    {{else if @localRealm.isEmpty}}
      <button {{on "click" this.openRealm}}>Open a local realm</button>
    {{/if}}
  </template>
    
  listing = directory(this, () => this.args.localRealm.isAvailable ? "http://local-realm/" : undefined)
  @service declare router: RouterService;

  @action
  openRealm() {
    this.args.localRealm.chooseDirectory();
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
}
