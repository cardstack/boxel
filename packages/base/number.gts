import {
  primitive,
  Component,
  useIndexBasedKey,
  deserialize,
  BaseDefConstructor,
  BaseInstanceType,
  FieldDef,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { TextInputFilter, DeserializedResult } from './text-input-filter';

function _deserialize(
  numberString: string | null | undefined,
  //TODO: It turns out at runtime, number value is being passed down.
  //Particularly, value 0 which is falsy can cause issues if not handled correctly
  //Work has to be done to sync [deserialize] in card-api with _deserialize
): DeserializedResult<number> {
  if (numberString == null || numberString == undefined) {
    return { value: null };
  }
  let maybeNumber = Number(numberString);
  if (Number.isNaN(maybeNumber) || !Number.isFinite(maybeNumber)) {
    return {
      value: null,
      errorMessage:
        'Input cannot be converted to a number. Please enter a valid number',
    };
  }
  if (maybeNumber > Number.MAX_SAFE_INTEGER) {
    return {
      value: null,
      errorMessage:
        'Input number is too large. Please enter a smaller number or consider using BigInteger base card.',
    };
  }
  if (maybeNumber < Number.MIN_SAFE_INTEGER) {
    return {
      value: null,
      errorMessage:
        'Input number is too small. Please enter a more positive number or consider using BigInteger base card.',
    };
  }
  return { value: maybeNumber };
}

function _serialize(val: number): string {
  return val.toString();
}

export default class NumberField extends FieldDef {
  static displayName = 'Number';
  static [primitive]: number;
  static [useIndexBasedKey]: never;
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    number: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(number).value as BaseInstanceType<T>;
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

  static atom = this.embedded;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{this.textInputFilter.asString}}
        @onInput={{this.textInputFilter.onInput}}
        @errorMessage={{this.textInputFilter.errorMessage}}
        @invalid={{this.textInputFilter.isInvalid}}
      />
    </template>

    textInputFilter: TextInputFilter<number> = new TextInputFilter(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      _deserialize,
      _serialize,
    );
  };
}
