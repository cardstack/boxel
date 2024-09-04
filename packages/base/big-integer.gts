import {
  primitive,
  Component,
  serialize,
  FieldDef,
  BaseDefConstructor,
  deserialize,
  BaseInstanceType,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';

function _serialize(val: bigint | null): string | undefined {
  return val == null ? undefined : String(val);
}

function _deserialize(string: string | null): bigint | null {
  if (!string) {
    return null;
  }

  let errorMessage = validate(string);
  if (errorMessage) {
    return null;
  } else {
    return BigInt(string);
  }
}

function validate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    BigInt(value);
  } catch (error: any) {
    return 'Not a valid big int';
  }
  return null;
}

class View extends Component<typeof BigIntegerField> {
  <template>
    {{_serialize @model}}
  </template>
}

class Edit extends Component<typeof BigIntegerField> {
  <template>
    <BoxelInput
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
    />
  </template>

  textInputValidator: TextInputValidator<bigint> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    _deserialize,
    _serialize,
    validate,
  );
}

export default class BigIntegerField extends FieldDef {
  static displayName = 'BigInteger';
  static [primitive]: bigint;
  static [serialize](val: bigint | null) {
    return _serialize(val);
  }
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    bigintString: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(bigintString ?? null) as BaseInstanceType<T>;
  }
  static [queryableValue](val: bigint | undefined): string | undefined {
    return _serialize(val ?? null);
  }
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
