import Component from '@glimmer/component';
import { getSearchResults } from '../resources/search';
import { type CardResource, catalogEntryRef, baseRealm } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

interface Signature {
  Args: {
    realmURL: string;
    onSelect?: (entry: CardResource | undefined) => void;
  }
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <section>
      <label for="select-realm">Choose a realm:</label>
      <select name="realm" id="select-realm" {{on "change" this.select}}>
        <option value="local">Local Realm</option>
        <option value="base">Base Realm</option>
      </select>
    </section>
    Available Card Types:
    <ul>
      {{#each this.entries as |entry|}}
        <li>
          {{entry.attributes.title}}
          {{#if @onSelect}}
            <button {{on "click" (fn @onSelect entry)}} type="button">
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
  @tracked catalogEntry = getSearchResults(this, () => ({
    filter: {
      type: catalogEntryRef,
    }
  }), this.selectedRealm);

  get entries() {
    return this.catalogEntry.instances;
  }

  updateCatalogEntries() {
    this.catalogEntry = getSearchResults(this, () => ({
      filter: {
        type: catalogEntryRef,
      }
    }), this.selectedRealm);
  }

  @action
  select(ev: Event) {
    let value = (ev.target as any)?.value;
    if (this.selectedRealm === value) {
      return;
    }
    switch(value) {
      case 'base':
        this.selectedRealm = baseRealm.url;
        this.updateCatalogEntries();
        break;
      default:
        this.selectedRealm = this.args.realmURL;
        this.updateCatalogEntries();
    }
  }
}
