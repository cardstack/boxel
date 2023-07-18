import {
  primitive,
  Component,
  CardBase,
  useIndexBasedKey,
  deserialize,
  CardBaseConstructor,
  CardInstanceType,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { TextInputFilter, DeserializedResult } from './text-input-filter';

function _deserialize(
  numberString: string | null | undefined
): DeserializedResult<number> {
  if (!numberString) {
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

export default class NumberCard extends CardBase {
  static [primitive]: number;
  static [useIndexBasedKey]: never;
  static async [deserialize]<T extends CardBaseConstructor>(
    this: T,
    number: any
  ): Promise<CardInstanceType<T>> {
    return _deserialize(number).value as CardInstanceType<T>;
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

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
      _serialize
    );
  };
}
