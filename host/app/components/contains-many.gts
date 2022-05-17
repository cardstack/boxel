import Component from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Card, Box, Constructable, Format } from '../lib/card-api';

interface Signature {
  Args: {
    model: Box<Card>,
    fieldName: keyof Card,
    arrayField: Box<Card[]>,
    format: Format;
    field: any,
    getComponent<CardT extends Constructable>(card: CardT, format: Format, model: Box<InstanceType<CardT>>): ComponentLike<{ Args: {}, Blocks: {} }>;
  };
}

export default class ContainsManyEditor extends Component<Signature> {
  <template>
    <section data-test-contains-many={{this.safeFieldName}}>
      <header>{{this.safeFieldName}}</header>
      <ul>
        {{#each @arrayField.children as |boxedElement i|}}
          <li data-test-item={{i}}>
            {{#let (this.getComponent @field.card @format boxedElement) as |Item|}}
              <Item />
            {{/let}}
            <button {{on "click" (fn this.remove i)}} type="button" data-test-remove={{i}}>Remove</button>
          </li>
        {{/each}}
      </ul>
      <button {{on "click" this.add}} type="button" data-test-add-new>Add New</button>
    </section>
  </template>

  getComponent = this.args.getComponent;

  get safeFieldName() {
    if (typeof this.args.fieldName !== 'string') {
      throw new Error(`ContainsManyEditor expects a string fieldName`);
    }
    return this.args.fieldName;
  }

  @action add() {
    (this.args.model.value as any)[this.safeFieldName] = [...this.args.arrayField.children.map(b => b.value), null];
  }

  @action remove(index: number) {
    let value = this.args.arrayField.children.map(b => b.value);
    value.splice(index, 1);
    (this.args.model.value as any)[this.safeFieldName] = [ ...value];
  }
}
