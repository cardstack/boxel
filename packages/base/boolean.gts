import {
  primitive,
  serialize,
  queryableValue,
  Component,
  useIndexBasedKey,
  FieldDef,
} from './card-api';
import { on } from '@ember/modifier';
import Modifier from 'ember-modifier';
import { fn } from '@ember/helper';
import pick from '@cardstack/boxel-ui/helpers/pick';

// this allows multiple radio groups rendered on the page
// to stay independent of one another.
let groupNumber = 0;

class View extends Component<typeof BooleanField> {
  <template>
    {{@model}}
  </template>

  get fieldName() {
    if (typeof this.args.fieldName === 'string') {
      return this.args.fieldName;
    }
    return undefined;
  }
}

export default class BooleanField extends FieldDef {
  static [primitive]: boolean;
  static [useIndexBasedKey]: never;
  static [serialize](val: any) {
    return Boolean(val);
  }
  static [queryableValue](val: any): boolean {
    if (typeof val === 'string') {
      return val.toLowerCase() === 'true';
    }
    return Boolean(val);
  }

  static embedded = View;
  static isolated = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div data-test-radio-group={{@fieldName}}>
        <label for='{{this.radioGroup}}_true'>
          True
          <input
            type='radio'
            {{RadioInitializer @model true}}
            id='{{this.radioGroup}}_true'
            name='{{this.radioGroup}}'
            checked={{@model}}
            {{on 'change' (pick 'target.value' (fn @set true))}}
          />
        </label>
        <label for='{{this.radioGroup}}_false'>
          False
          <input
            type='radio'
            {{RadioInitializer @model false}}
            id='{{this.radioGroup}}_false'
            name='{{this.radioGroup}}'
            checked={{not @model}}
            {{on 'change' (pick 'target.value' (fn @set false))}}
          />
        </label>
      </div>
    </template>

    private radioGroup = `__cardstack_bool${groupNumber++}__`;
    constructor(owner: unknown, args: any) {
      super(owner, args);
      // initializes to false
      if (this.args.model === undefined) {
        this.args.set(false);
      }
    }
  };
}

function not(val: any) {
  return !val;
}

interface Signature {
  element: HTMLInputElement;
  Args: {
    Positional: [model: boolean | null, inputType: boolean];
  };
}

class RadioInitializer extends Modifier<Signature> {
  modify(
    element: HTMLInputElement,
    [model, inputType]: Signature['Args']['Positional'],
  ) {
    element.checked = model === inputType;
  }
}
