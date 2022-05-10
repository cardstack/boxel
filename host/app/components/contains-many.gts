import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { pick } from '../lib/pick';
import { Card } from '../lib/card-api';

interface Signature {
  Args: { fieldName: string, model: Card, items: any[] };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section>
      <header>{{@fieldName}}</header>
      <ul>
        {{#each @items as |item i|}}
          <li data-test-item={{i}}>
            {{!-- template-lint-disable require-input-label --}}
            <input value={{item}} {{on "input" (pick "target.value" (fn this.edit i))}}>
            <button {{on "click" (fn this.remove i)}} type="button" data-test-remove={{i}}>Remove</button>
          </li>
        {{/each}}
      </ul>
      <button {{on "click" this.add}} type="button" data-test-add-new>Add New</button>
    </section>
  </template>

  @action add() {
    (this.args.model as any)[this.args.fieldName] = [...this.args.items, ''];
  }

  @action remove(index: number) {
    let filtered = this.args.items.slice(0, index).concat(this.args.items.slice(index + 1));
    (this.args.model as any)[this.args.fieldName] = filtered;
  }

  @action edit(index: number, val: string) {
    this.args.items[index] = val;
    (this.args.model as any)[this.args.fieldName] = this.args.items;
  }
}
