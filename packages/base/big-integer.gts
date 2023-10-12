import {
  primitive,
  Component,
  serialize,
  BaseInstanceType,
  BaseDefConstructor,
  deserialize,
  queryableValue,
  FieldDef,
} from './card-api';
import BoxelInput from '@cardstack/boxel-ui/components/input';
import { TextInputFilter, DeserializedResult } from './text-input-filter';

function _deserialize(
  bigintString: string | null | undefined,
): DeserializedResult<bigint> {
  if (bigintString == null || bigintString == undefined) {
    return { value: null };
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
        /The number (.*) cannot be converted to a BigInt because it is not an integer/,
      ) &&
        e instanceof RangeError)
    ) {
      return { value: null, errorMessage: 'Not a valid big int' };
    }
    throw e;
  }
}

function _serialize(val: bigint): string {
  return val.toString();
}

class View extends Component<typeof BigIntegerField> {
  <template>
    {{this.formatted}}
  </template>

  get formatted() {
    if (!this.args.model) {
      return;
    }
    return _serialize(this.args.model);
  }
}

class Edit extends Component<typeof BigIntegerField> {
  <template>
    <BoxelInput
      @value={{this.textInputFilter.asString}}
      @onInput={{this.textInputFilter.onInput}}
      @errorMessage={{this.textInputFilter.errorMessage}}
      @invalid={{this.textInputFilter.isInvalid}}
    />
  </template>

  textInputFilter: TextInputFilter<bigint> = new TextInputFilter(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    _deserialize,
    _serialize,
  );
}

export default class BigIntegerField extends FieldDef {
  static displayName = 'BigInteger';
  static [primitive]: bigint;
  static [serialize](val: bigint) {
    return _serialize(val);
  }
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    bigintString: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(bigintString).value as BaseInstanceType<T>;
  }
  static [queryableValue](val: bigint | undefined): string | undefined {
    if (val) {
      return BigIntegerField[serialize](val);
    } else {
      return undefined;
    }
  }

  static embedded = View;
  static atom = View;
  static edit = Edit;
}
