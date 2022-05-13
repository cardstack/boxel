import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Card } from '../lib/card-api';

interface Signature {
  Args: { components: any[], model: Card, items: any[], fieldName: string };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section data-test-contains-many={{@fieldName}}>
      <header>{{@fieldName}}</header>
      <ul>
        {{#each @components as |Item i|}}
          <li data-test-item={{i}}>
            <Item />
            <button {{on "click" (fn this.remove i)}} type="button" data-test-remove={{i}}>Remove</button>
          </li>
        {{/each}}
      </ul>
      <button {{on "click" this.add}} type="button" data-test-add-new>Add New</button>
    </section>
  </template>

  @action add() {
    (this.args.model as any)[this.args.fieldName] = [...this.args.items, null];
  }

  @action remove(index: number) {
    let filtered = this.args.items.slice(0, index).concat(this.args.items.slice(index + 1));
    (this.args.model as any)[this.args.fieldName] = filtered;
  }

}
