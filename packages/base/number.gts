import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  deserialize,
  BaseInstanceType,
  BaseDefConstructor,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';

function serialize(val: number): string {
  return val.toString();
}

function _deserialize(
  number: number | string | null | undefined,
): number | null {
  if (number == null) {
    return null;
  }
  debugger;
  let errorMessage = validate(number);

  if (errorMessage) {
    return null;
  } else {
    return Number(number);
  }
}

function validate(value: string | number | null): string | null {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return 'Input cannot be converted to a number. Please enter a valid number.';
    }
  } else {
    if (value.endsWith('.')) {
      return 'Input cannot end with a decimal point. Please enter a valid number.';
    }

    let number = Number(value);

    if (Number.isNaN(number)) {
      return 'Input cannot be converted to a number. Please enter a valid number.';
    }

    if (number > Number.MAX_SAFE_INTEGER) {
      return 'Input number is too large. Please enter a smaller number or consider using BigInteger base card.';
    }
    if (number < Number.MIN_SAFE_INTEGER) {
      return 'Input number is too small. Please enter a more positive number or consider using BigInteger base card.';
    }
  }

  return null;
}

class View extends Component<typeof NumberField> {
  <template>
    {{@model}}
  </template>
}

export default class NumberField extends FieldDef {
  static displayName = 'Number';
  static [primitive]: number;
  static [useIndexBasedKey]: never;
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    number: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(number) as BaseInstanceType<T>;
  }
  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{this.textInputFilter.asString}}
        @onInput={{this.textInputFilter.onInput}}
        @errorMessage={{this.textInputFilter.errorMessage}}
        @state={{if this.textInputFilter.isInvalid 'invalid' 'none'}}
      />
    </template>

    textInputFilter: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      _deserialize,
      serialize,
      validate,
    );
  };
}
