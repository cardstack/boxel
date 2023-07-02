import {
  primitive,
  Component,
  CardBase,
  // useIndexBasedKey,
  serialize,
  CardInstanceType,
  CardBaseConstructor,
  deserialize,
} from './card-api';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui';

export default class BigIntegerCard extends CardBase {
  static [primitive]: bigint;
  static [serialize](n: bigint) {
    return n.toString();
  }
  static async [deserialize]<T extends CardBaseConstructor>(
    this: T,
    bigintString: any
  ): Promise<CardInstanceType<T>> {
    if (typeof bigintString === 'bigint') {
      return bigintString as CardInstanceType<T>;
    }

    if (typeof bigintString === 'string' || typeof bigintString === 'number') {
      try {
        return BigInt(bigintString) as CardInstanceType<T>;
      } catch {
        return bigintString as CardInstanceType<T>;
      }
    }
    return bigintString as CardInstanceType<T>;
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
      />
    </template>

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return _serialize(this.args.model);
    }

    parseInput(set: Function, value: string) {
      try {
        let formatted = this.formatted;
        if (!formatted) {
          return;
        }
        return set(_deserialize(formatted));
      } catch (error) {
        debugger;
        console.error('Invalid BigInt value:', value);
      }
    }
  };
}

async function _deserialize(value: string | number): Promise<bigint> {
  return BigIntegerCard[deserialize](value);
}
function _serialize(value: bigint): string {
  return BigIntegerCard[serialize](value);
}
