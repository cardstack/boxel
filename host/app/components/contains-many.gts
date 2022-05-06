import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Card } from '../lib/card-api';

interface Signature {
  Args: { fieldName: string, model: Card, items: any[], components: any[] }
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section>
      <header>{{@fieldName}}</header>
      <ul>
        {{#each @items as |item|}}
          <li data-test-item={{item}}>
            {{item}}
            <button {{on "click" (fn this.removeItem item)}} type="button" data-test-remove={{item}}>
              Remove
            </button>
          </li>
        {{/each}}
        <button {{on "click" (fn this.addItem 'french')}} type="button" data-test-add-new>
          Add New
        </button>
      </ul>
    </section>

    <div data-test-output>
      {{#each @components as |Item|}}
        <Item/>
      {{/each}}
    </div>
  </template>

  @action addItem(newItem: unknown) {
    (this.args.model as any)[this.args.fieldName] = [...this.args.items, newItem];
  }

  @action removeItem(item: unknown) {
    let filtered = this.args.items.filter((el: unknown) => el !== item);
    (this.args.model as any)[this.args.fieldName] = filtered;
  }
}
