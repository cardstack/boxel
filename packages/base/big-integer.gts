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
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui';
import { not } from '@cardstack/boxel-ui/helpers/truth-helpers';

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

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
        @errorMessage={{this.errorMessage}}
        @invalid={{not this.isValidBigInt}}
      />
    </template>

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return _serialize(this.args.model);
    }

    get isValidBigInt() {
      try {
        if (!this.args.model) {
          return false;
        }
        BigInt(this.args.model);
        return true;
      } catch {
        return false;
      }
    }

    get errorMessage() {
      return 'Invalid Big Int value.';
    }

    async parseInput(set: Function, bigintString: string) {
      return set(_deserialize(bigintString));
    }
  };
}

function _serialize(val: bigint): string {
  return val.toString();
}

function _deserialize(bigintString: any): any {
  if (typeof bigintString === 'bigint') {
    return bigintString;
  }
  try {
    let bigintVal = BigInt(bigintString);
    return bigintVal;
  } catch (e) {
    // passes original value back to the form
    return bigintString;
  }
}
