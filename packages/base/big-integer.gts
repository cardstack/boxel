import {
  primitive,
  Component,
  serialize,
  FieldDef,
  deserialize,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';
import { not } from '@cardstack/boxel-ui/helpers';
import Number99SmallIcon from '@cardstack/boxel-icons/number-99-small';
import { BigIntegerSerializer } from '@cardstack/runtime-common';

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

function deserializeForUI(value: string | null): bigint | null {
  const validationError = validate(value);
  if (validationError) {
    return null;
  }

  return BigIntegerSerializer.deserializeSync(value);
}

class View extends Component<typeof BigIntegerField> {
  <template>
    {{BigIntegerSerializer.serialize @model}}
  </template>
}

class Edit extends Component<typeof BigIntegerField> {
  <template>
    <BoxelInput
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
      @disabled={{not @canEdit}}
    />
  </template>

  textInputValidator: TextInputValidator<bigint> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    deserializeForUI,
    BigIntegerSerializer.serialize,
    validate,
  );
}

export default class BigIntegerField extends FieldDef {
  static displayName = 'BigInteger';
  static icon = Number99SmallIcon;
  static [primitive]: bigint;
  static [serialize] = BigIntegerSerializer.serialize;
  static [deserialize] = BigIntegerSerializer.deserialize;
  static [queryableValue] = BigIntegerSerializer.queryableValue;
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
