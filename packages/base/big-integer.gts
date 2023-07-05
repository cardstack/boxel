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
import { tracked } from '@glimmer/tracking';

class ValidatorEditor<T> {
  constructor(
    private getValue: () => T | null,
    private setValue: (val: T | null | undefined) => void,
    private serialize: (val: T | null) => string | undefined,
    private deserialize: (value: string) => T | null | undefined
  ) {}
  @tracked lastEditingValue: string | undefined;

  get current(): string {
    let serialized = this.serialize(this.getValue());
    if (serialized != null && this.lastEditingValue !== serialized) {
      return serialized;
    }
    return this.lastEditingValue || '';
  }

  get isInvalid() {
    return this.current.length > 0 && this.getValue() == null;
  }

  get errorMessage(): string | undefined {
    if (this.isInvalid) {
      return 'Not a valid field input';
    }
    return;
  }

  parseInput = async (inputVal: string) => {
    let deserializedValue = this.deserialize(inputVal);
    this.setValue(deserializedValue);
    this.lastEditingValue = inputVal;
  };
}

function _deserialize(bigintString: string | null): bigint | undefined {
  if (!bigintString) {
    return undefined;
  }
  try {
    let bigintVal = BigInt(bigintString);
    return bigintVal;
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
      return undefined;
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

  validatorEditor = new ValidatorEditor(
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
    return _deserialize(bigintString) as CardInstanceType<T>;
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
