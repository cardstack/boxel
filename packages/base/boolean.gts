import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  emptyValue,
} from './card-api';
import { fn } from '@ember/helper';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import ToggleLeftIcon from '@cardstack/boxel-icons/toggle-left';
import { fieldSerializer } from '@cardstack/runtime-common';

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
  static icon = ToggleLeftIcon;
  static [primitive]: boolean;
  static [fieldSerializer] = 'boolean';
  static [useIndexBasedKey]: never;

  static [emptyValue] = false;

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
          @disabled={{not @canEdit}}
          as |item|
        >
          <item.component @onChange={{fn @set item.data.value}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>
      </div>
    </template>

    private items = [
      { id: 'false', value: false, text: 'False' },
      { id: 'true', value: true, text: 'True' },
    ];

    private radioGroup = `__cardstack_bool${groupNumber++}__`;

    get checkedId() {
      return String(this.args.model);
    }
  };
}
