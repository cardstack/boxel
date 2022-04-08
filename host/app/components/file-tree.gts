import Component from '@glint/environment-ember-loose/glimmer-component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';

function eq<T>(a: T, b: T, _namedArgs: unknown): boolean {
  return a === b;
}

interface Args {
  Args: {
    localRealm: LocalRealm;
    file: string | undefined;
    onSelectedFile: (entry: Entry | undefined) => void;
  }
}

export default class FileTree extends Component<Args> {
  <template>
    {{#if @localRealm.isAvailable}}
      <button {{on "click" this.closeRealm}}>Close local realm</button>
      {{#each this.listing.entries as |entry|}}
        {{#if (eq entry.handle.kind 'file')}}
          <div class="item file {{if (eq entry.name this.args.file) 'selected'}} indent-{{entry.indent}}"
            {{on "click" (fn this.open entry)}}>
          {{entry.name}}
          </div>
        {{else}}
          <div class="item directory indent-{{entry.indent}}">
            {{entry.name}}/
          </div>
        {{/if}}
      {{/each}}
    {{else if @localRealm.isLoading }}
      ...
    {{else if @localRealm.isEmpty}}
      <button {{on "click" this.openRealm}}>Open a local realm</button>
    {{/if}}
  </template>
    
  listing = directory(this, () => this.args.localRealm.isAvailable ? this.args.localRealm.fsHandle : null)

  @action
  openRealm() {
    this.args.localRealm.chooseDirectory();
  }

  @action
  closeRealm() {
    if (this.args.localRealm.isAvailable) {
      this.args.localRealm.close();
      this.args.onSelectedFile(undefined);
    }
  }

  @action
  open(handle: Entry) {
    this.args.onSelectedFile(handle);
  }
}
