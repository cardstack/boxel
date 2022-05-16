import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Card, Box } from '../lib/card-api';

interface Signature {
  Args: { components: any[], model: Box<Card>, items: Box<Card>[], fieldName: keyof Card };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section data-test-contains-many={{this.safeFieldName}}>
      <header>{{this.safeFieldName}}</header>
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

  get safeFieldName() {
    if (typeof this.args.fieldName !== 'string') {
      throw new Error(`ContainsManyEditor expects a string fieldName`);
    }
    return this.args.fieldName;
  }

  @action add() {
    let fieldBox = this.args.model.field(this.safeFieldName) as unknown as Box<Card[]>;
    let cardBox = fieldBox?.containingBox;
    if (!cardBox) {
      throw new Error(`cannot determine the card that ${this.safeFieldName} belongs to`);
    }
    cardBox.value[this.safeFieldName] = [...this.args.items.map(b => b.value), null];
  }

  @action remove(index: number) {
    let fieldBox = this.args.model.field(this.safeFieldName) as unknown as Box<Card[]>;
    let cardBox = fieldBox?.containingBox;
    if (!cardBox) {
      throw new Error(`cannot determine the card that ${this.safeFieldName} belongs to`);
    }
    cardBox.value[this.safeFieldName] = this.args.items.map(b => b.value).splice(index, 1);
  }
}
