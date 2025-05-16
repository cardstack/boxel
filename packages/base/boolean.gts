import {
  primitive,
  serialize,
  queryableValue,
  formatQuery,
  Component,
  useIndexBasedKey,
  FieldDef,
  BaseDefConstructor,
  BaseInstanceType,
  deserialize,
  emptyValue,
} from './card-api';
import { fn } from '@ember/helper';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import ToggleLeftIcon from '@cardstack/boxel-icons/toggle-left';

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
  static [useIndexBasedKey]: never;
  static [serialize](val: any) {
    return Boolean(val);
  }

  static get [emptyValue]() {
    return false;
  }

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    val: any,
  ): Promise<BaseInstanceType<T>> {
    if (val === undefined || val === null) {
      return false as BaseInstanceType<T>;
    }
    return Boolean(val) as BaseInstanceType<T>;
  }

  static [queryableValue](val: any): boolean {
    return asBoolean(val);
  }
  static [formatQuery](val: any): boolean {
    return asBoolean(val);
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

function asBoolean(val: any): boolean {
  if (typeof val === 'string') {
    return val.toLowerCase() === 'true';
  }
  return Boolean(val);
}
