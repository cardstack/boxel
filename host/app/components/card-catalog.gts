import Component from '@glimmer/component';
import { getSearchResults } from '../resources/search';
import { type CardResource, catalogEntryRef } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

interface Signature {
  Args: {
    onSelect?: (entry: CardResource | undefined) => void;
  }
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <ul>
      {{#each this.catalogEntry.instances as |entry|}}
        <li>
          {{entry.attributes.title}}
          {{#if @onSelect}}
            <button {{on "click" (fn @onSelect entry)}} type="button">
              Select
            </button>
          {{/if}}
        </li>
      {{/each}}
    </ul>
  </template>

  catalogEntry = getSearchResults(this, () => ({
    filter: { type: catalogEntryRef }
  }));
}
