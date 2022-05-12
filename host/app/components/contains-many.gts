import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { pick } from '../lib/pick';
import { get } from '@ember/helper';
import { Card, Setter } from '../lib/card-api';

interface Signature {
  Args: { model: Card, items: any[], fieldName: string, setters: Setter[] };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section data-test-contains-many-editor={{@fieldName}}>
      <button {{on "click" this.sortAsc}} type="button" data-test-sort-asc>Sort (Ascending)</button>
      <button {{on "click" this.sortDesc}} type="button" data-test-sort-desc>Sort (Descending)</button>
      <header>{{@fieldName}}</header>
      <ul>
        {{#each @items as |item i|}}
          <li data-test-item={{i}}>
            <label>
              {{#let (get @setters i) as |set|}}
                {{i}}: <input value={{item}} {{on "input" (pick "target.value" set)}}>
              {{/let}}
            </label>
            <button {{on "click" (fn this.remove i)}} type="button" data-test-remove="{{i}}">Remove</button>
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

  @action sortAsc() {
    if (typeof this.args.items[0] === 'number') {
       this.args.items.sort((a, b) => a - b);
    } else {
      this.args.items.sort((a, b) => a.localeCompare(b));
    }
    (this.args.model as any)[this.args.fieldName] = this.args.items;
  }

  @action sortDesc() {
    if (typeof this.args.items[0] === 'number') {
      this.args.items.sort((a, b) => b - a);
   } else {
     this.args.items.sort((a, b) => b.localeCompare(a));
   }
   (this.args.model as any)[this.args.fieldName] = this.args.items;
  }

}
