import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  deserialize,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';
import { not } from '@cardstack/boxel-ui/helpers';
import HashIcon from '@cardstack/boxel-icons/hash';
import { NumberSerializer } from '@cardstack/runtime-common';

function validate(value: string | number | null): string | null {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 'Input must be a finite number.';
    }
  } else {
    if (value.endsWith('.')) {
      return 'Input cannot end with a decimal point.';
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return 'Input must be a valid number.';
    }

    let minSafe = Number.MIN_SAFE_INTEGER;
    let maxSafe = Number.MAX_SAFE_INTEGER;

    if (number > maxSafe || number < minSafe) {
      return `Input number is out of safe range. Please enter a number between ${minSafe} and ${maxSafe}.`;
    }
  }

  return null;
}

function deserializeForUI(value: string | number | null): number | null {
  const validationError = validate(value);
  if (validationError) {
    return null;
  }

  return NumberSerializer.deserializeSync(value);
}

class View extends Component<typeof NumberField> {
  <template>
    {{@model}}
  </template>
}

export default class NumberField extends FieldDef {
  static displayName = 'Number';
  static icon = HashIcon;
  static [primitive]: number;
  static [useIndexBasedKey]: never;
  static [deserialize] = NumberSerializer.deserialize;
  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        @disabled={{not @canEdit}}
      />
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      NumberSerializer.serialize,
      validate,
    );
  };
}
