import { primitive, serialize, Component, Card, useIndexBasedKey } from './card-api';
import { on, } from '@ember/modifier';
import Modifier from 'ember-modifier';
import { fn } from '@ember/helper';
import { pick } from './pick';

// this allows multiple radio groups rendered on the page
// to stay independent of one another.
let groupNumber = 0;

class View extends Component<typeof BooleanCard> {
  <template>{{this.fieldName}}: {{@model}}</template>
  
  get fieldName() {
    if (typeof this.args.fieldName === 'string') { 
      return this.args.fieldName;
    }
    return undefined;
  }
}

export default class BooleanCard extends Card {
  static [primitive]: boolean;
  static [useIndexBasedKey]: never;
  static [serialize](val: any) {
    return Boolean(val);
  }

  static embedded = View;
  static isolated = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <label for="{{this.radioGroup}}_true">
        true
        <input type="radio" 
          {{RadioInitializer @model true}}
          id="{{this.radioGroup}}_true"
          name="{{this.radioGroup}}" 
          checked={{@model}}
          {{on "change" (pick "target.value" (fn @set true))}}
        />
      </label>
      <label for="{{this.radioGroup}}_false">
        false
        <input type="radio" 
          {{RadioInitializer @model false}}
          id="{{this.radioGroup}}_false"
          name="{{this.radioGroup}}" 
          checked={{not @model}}
          {{on "change" (pick "target.value" (fn @set false))}}
        />
      </label>
    </template>

    private radioGroup = `__cardstack_bool${groupNumber++}__`;
    constructor(owner: unknown, args: any) {
      super(owner, args);
      // initializes to false
      if (this.args.model === undefined) {
        this.args.set(false);
      }
    }
  }
}

function not(val: boolean) {
  return !val;
}


interface Signature {
  element: HTMLInputElement;
  Args: {
    Positional: [model: boolean, inputType: boolean];
  }
}

class RadioInitializer extends Modifier<Signature> {
  modify(
    element: HTMLInputElement,
    [model, inputType]: Signature["Args"]["Positional"]
  ) {
    element.checked = model === inputType;
  }
}