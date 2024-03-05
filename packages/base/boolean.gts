import {
  primitive,
  serialize,
  queryableValue,
  Component,
  useIndexBasedKey,
  FieldDef,
} from './card-api';
import { fn } from '@ember/helper';
import { RadioInput } from '@cardstack/boxel-ui/components';

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
  static displayName = 'Boolean';
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
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div data-test-radio-group={{@fieldName}}>
        <RadioInput
          @items={{this.items}}
          @groupDescription='Boolean field'
          name='{{this.radioGroup}}'
          @checkedId={{this.checkedId}}
          @hideBorder={{true}}
          as |item|
        >
          <item.component @onChange={{fn @set item.data.value}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>
      </div>
    </template>

    private items = [
      { id: 'true', value: true, text: 'True' },
      { id: 'false', value: false, text: 'False' },
    ];

    private radioGroup = `__cardstack_bool${groupNumber++}__`;

    get checkedId() {
      console.log(this.args.model);
      return this.args.model === undefined || this.args.model === null
        ? 'false'
        : String(this.args.model);
    }
  };
}
