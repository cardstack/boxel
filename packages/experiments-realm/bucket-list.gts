import {
  CardDef,
  field,
  contains,
  containsMany,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import { ChipsEditor } from './components/chips-editor';

// BucketList Isolated View - now uses the reusable ChipsComponent
class BucketListIsolated extends Component<typeof BucketList> {
  updateItems = (items: string[]) => {
    this.args.model.items = items;
  };

  get listingName() {
    const hasName = !!this.args.model.name?.trim();
    return hasName ? this.args.model.name : 'Untitled List';
  }

  <template>
    <header>
      <h3>{{this.listingName}} ({{if @model.items @model.items.length 0}})</h3>
    </header>

    <ChipsEditor
      @name={{this.listingName}}
      @items={{@model.items}}
      @onItemsUpdate={{this.updateItems}}
      @placeholder='Add new bucket list item...'
    />

    <style scoped>
      header {
        background-color: var(--boxel-cyan);
        padding: var(--boxel-sp-sm);
      }
    </style>
  </template>
}

export class BucketList extends CardDef {
  @field name = contains(StringField);
  @field items = containsMany(StringField);

  static isolated = BucketListIsolated;
}
