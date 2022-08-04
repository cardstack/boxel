import Component from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type { Card, Box, CardConstructor, Format } from './card-api';

interface Signature {
  Args: {
    model: Box<Card>,
    fieldName: string,
    arrayField: Box<Card[]>,
    format: Format;
    field: any,
    getComponent<CardT extends CardConstructor>(card: CardT, format: Format, model: Box<InstanceType<CardT>>): ComponentLike<{ Args: {}, Blocks: {} }>;
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

  get getComponent() {
    return this.args.getComponent;
  }

  get safeFieldName() {
    if (typeof this.args.fieldName !== 'string') {
      throw new Error(`ContainsManyEditor expects a string fieldName`);
    }
    return this.args.fieldName;
  }

  @action add() {
    // TODO probably each field card should have the ability to say what a new item should be
    (this.args.model.value as any)[this.safeFieldName].push(null);
  }

  @action remove(index: number) {
    (this.args.model.value as any)[this.safeFieldName].splice(index, 1);
  }
}
