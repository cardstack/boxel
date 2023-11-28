import { primitive, Component, useIndexBasedKey, FieldDef } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';

function serialize(val: number): string {
  return val.toString();
}

function deserialize(string: string | null | undefined): number | null {
  if (string == null || string === '') {
    return null;
  }
  return Number(string);
}

function validate(value: string | null): string | null {
  if (value == null || value === '') {
    return null;
  }

  if (value.endsWith('.')) {
    return 'Input cannot end with a decimal point. Please enter a valid number.';
  }

  let number = Number(value);

  if (Number.isNaN(number) || !Number.isFinite(number)) {
    return 'Input cannot be converted to a number. Please enter a valid number.';
  }
  if (number > Number.MAX_SAFE_INTEGER) {
    return 'Input number is too large. Please enter a smaller number or consider using BigInteger base card.';
  }
  if (number < Number.MIN_SAFE_INTEGER) {
    return 'Input number is too small. Please enter a more positive number or consider using BigInteger base card.';
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
      deserialize,
      serialize,
      validate,
    );
  };
}
