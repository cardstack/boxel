import Component from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Card, Box, Constructable, Format, getCachedComponent } from '../lib/card-api';

interface Signature {
  Args: {
    model: Box<Card>,
    fieldName: keyof Card,
    format: Format;
    field: Constructable,
    getComponent<CardT extends Constructable>(card: CardT, format: Format, model: Box<InstanceType<CardT>>): ComponentLike<{ Args: {}, Blocks: {} }>;
  };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section data-test-contains-many={{this.safeFieldName}}>
      <header>{{this.safeFieldName}}</header>
      <ul>
        {{#each this.components as |Item i|}}
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

  get components() {
    return this.items.map((element, i) => getCachedComponent(this.args.model.value, `${this.safeFieldName}_${i}`, () => this.args.getComponent(this.args.field, this.args.format, element)));
  }

  get items() {
    let innerModel = this.args.model.field(this.args.fieldName as keyof Card) as unknown as Box<Card[]>; // casts are safe because we know the field is present
    return innerModel.asBoxedArray();
  }

  @action add() {
    (this.args.model.value as any)[this.safeFieldName] = [...this.items.map(b => b.value), null];
  }

  @action remove(index: number) {
    let value = this.items.map(b => b.value);
    value.splice(index, 1);
    (this.args.model.value as any)[this.safeFieldName] = [ ...value];
  }
}
