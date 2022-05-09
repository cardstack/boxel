import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { pick } from '../lib/pick';
import { Card } from '../lib/card-api';

interface Signature {
  Args: { fieldName: string, model: Card, items: any[], components: any[], newItem: any };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section>
      <header>{{@fieldName}}</header>
      <ul>
        {{#each @components as |Item i|}}
          <li data-test-item={{i}}>
            <Item />
            <button {{on "click" (fn this.removeItem i)}} type="button" data-test-remove={{i}}>
              Remove
            </button>
          </li>
        {{/each}}
      </ul>
      <label>
        <div>Add New Item:</div>
        <input {{on "input" (pick "target.value" this.set)}} {{on "keyup" this.maybeAddItem}} value={{this.value}} data-test-new-item-input>
      </label>
      <button {{on "click" this.addItem}} type="button" data-test-add-new>
        Add
      </button>
    </section>
  </template>

  @tracked value = '';

  @action addItem() {
    if (this.value.trim()) {
      (this.args.model as any)[this.args.fieldName] = [...this.args.items, this.value];
    }
    this.value = '';
  }

  @action removeItem(item: number) {
    let filtered = this.args.items.slice(0, item).concat(this.args.items.slice(item + 1));
    (this.args.model as any)[this.args.fieldName] = filtered;
  }

  @action set(val: string) {
    this.value = val;
  }

  @action maybeAddItem(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.addItem();
    }
  }
}
