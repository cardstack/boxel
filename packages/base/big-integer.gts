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
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

function _deserialize(bigintString: string | null): bigint | undefined {
  if (!bigintString) {
    return undefined;
  }
  try {
    let bigintVal = BigInt(bigintString);
    return bigintVal;
  } catch (e: any) {
    // passes original value back to the form
    const re = /Cannot convert (.*) to a BigInt/;
    if (e.message && e.message.match(re) && e instanceof SyntaxError) {
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
      @value={{this.editingValue}}
      @onInput={{this.parseInput}}
      @errorMessage={{this.errorMessage}}
      @invalid={{this.isInvalidBigInt}}
    />
    <button {{on 'click' this.testGetter}}>Test Getter</button>
  </template>

  testGetter = () => {
    this.args.set(333);
  };

  @tracked lastEditingValue: string | undefined;

  // TODO: generalise input validation logic in a ember resource (perhaps just a class)
  // instantiate class in Edit component

  get editingValue(): string {
    let serialized = _serialize(this.args.model);
    if (serialized != null && this.lastEditingValue !== serialized) {
      return serialized;
    }
    return this.lastEditingValue || '';
  }

  get formatted() {
    if (!this.args.model) {
      return;
    }
    return _serialize(this.args.model);
  }

  get isInvalidBigInt() {
    return this.editingValue.length > 0 && this.args.model == null;
  }

  get errorMessage(): string | undefined {
    if (this.isInvalidBigInt) {
      return 'Not a valid big int';
    }
    return;
  }

  parseInput = async (bigintString: string) => {
    let newValue = _deserialize(bigintString);
    this.args.set(newValue);
    this.lastEditingValue = bigintString;
  };
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
