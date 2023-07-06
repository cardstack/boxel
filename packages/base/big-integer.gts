import {
  primitive,
  Component,
  CardBase,
  serialize,
  CardInstanceType,
  CardBaseConstructor,
  deserialize,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { FieldInputEditor, DeserializedResult } from './field-input-editor';

function _deserialize(bigintString: string | null): DeserializedResult<bigint> {
  if (!bigintString) {
    return { value: null, errorMessage: 'big int undefined' };
  }
  try {
    let bigintVal = BigInt(bigintString);
    return { value: bigintVal };
  } catch (e: any) {
    if (
      (e.message &&
        e.message.match(/Cannot convert (.*) to a BigInt/) &&
        e instanceof SyntaxError) ||
      (e.message.match(
        /The number (.*) cannot be converted to a BigInt because it is not an integer/
      ) &&
        e instanceof RangeError)
    ) {
      return { value: null, errorMessage: 'Not a valid big int' };
    }
    throw e;
  }
}

function _serialize(val: bigint | null): string | undefined {
  if (!val) {
    return undefined;
  }
  return val.toString();
}

class Edit extends Component<typeof BigIntegerCard> {
  <template>
    <BoxelInput
      @value={{this.validatorEditor.current}}
      @onInput={{this.validatorEditor.parseInput}}
      @errorMessage={{this.validatorEditor.errorMessage}}
      @invalid={{this.validatorEditor.isInvalid}}
    />
  </template>

  validatorEditor: FieldInputEditor<bigint> = new FieldInputEditor(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    _serialize,
    _deserialize
  );
}

export default class BigIntegerCard extends CardBase {
  static [primitive]: bigint;
  static [serialize](val: bigint) {
    return _serialize(val);
  }
  static async [deserialize]<T extends CardBaseConstructor>(
    this: T,
    bigintString: any
  ): Promise<CardInstanceType<T>> {
    return _deserialize(bigintString).value as CardInstanceType<T>;
  }
  static [queryableValue](val: bigint | undefined): string | undefined {
    if (val) {
      return BigIntegerCard[serialize](val);
    } else {
      return undefined;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{this.formatted}}
    </template>

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return _serialize(this.args.model);
    }
  };

  static edit = Edit;
}
