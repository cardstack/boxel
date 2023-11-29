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

function serialize(val: number | null): string | undefined {
  return val ? val.toString() : undefined;
}

function _deserialize(number: number | string | null): number | null {
  if (number == null) {
    return null;
  }

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
    if (!Number.isFinite(value)) {
      return 'Input must be a finite number. Please enter a valid number.';
    }
  } else {
    if (value.endsWith('.')) {
      return 'Input cannot end with a decimal point. Please enter a valid number.';
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return 'Input must be a valid number. Please enter a valid number.';
    }

    let minSafe = Number.MIN_SAFE_INTEGER;
    let maxSafe = Number.MAX_SAFE_INTEGER;

    if (number > maxSafe || number < minSafe) {
      return `Input number is out of safe range. Please enter a number between ${minSafe} and ${maxSafe}.`;
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
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
      />
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      _deserialize,
      serialize,
      validate,
    );
  };
}
