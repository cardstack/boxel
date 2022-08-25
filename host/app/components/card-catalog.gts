import Component from '@glimmer/component';
import { getSearchResults } from '../resources/search';
import { type CardResource, catalogEntryRef, baseRealm } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import ImportedModuleEditor from './imported-module-editor';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';

interface Signature {
  Args: {
    realmURL: string;
    onSelect?: (entry: CardResource | undefined) => void;
  }
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <div data-test-select-realm>
      <label for="select-realm">Choose a realm:</label>
      <select name="realm" id="select-realm" {{on "change" this.select}}>
        <option value="local">Local Realm</option>
        <option value="base">Base Realm</option>
      </select>
    </div>
    <ul class="card-catalog" data-test-card-catalog>
      {{#each this.entries as |entry|}}
        <li data-test-card-catalog-item={{entry.id}}>
          <ImportedModuleEditor
            @moduleURL={{entry.meta.adoptsFrom.module}}
            @cardArgs={{hash type="existing" url=entry.id format="embedded"}}
          />
          {{#if @onSelect}}
            <button {{on "click" (fn @onSelect entry)}} type="button" data-test-select={{entry.id}}>
              Select
            </button>
          {{/if}}
        </li>
      {{else}}
        None
      {{/each}}
    </ul>
  </template>

  @tracked selectedRealm = this.args.realmURL;
  catalogEntry = getSearchResults(this,
    () => ({ filter: { type: catalogEntryRef }}),
    () => this.selectedRealm
  );

  get entries() {
    return this.catalogEntry.instances;
  }

  @action
  select(ev: Event) {
    let value = (ev.target as any)?.value;
    if (value === this.selectedRealm) {
      return;
    }
    if (value === 'base') {
      this.selectedRealm = baseRealm.url;
    } else {
      this.selectedRealm = this.args.realmURL;
    }
  }
}
