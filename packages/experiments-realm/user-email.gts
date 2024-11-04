import {
  FieldDef,
  primitive,
  useIndexBasedKey,
  deserialize,
  BaseInstanceType,
  BaseDefConstructor,
  queryableValue,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from '../base/text-input-validator';

function isValidEmail(email: string): boolean {
  let emailRegex = new RegExp(
    "^[-!#$%&'*+\\/0-9=?A-Z^_a-z{|}~](\\.?[-!#$%&'*+\\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\\.?[a-zA-Z0-9])*\\.[a-zA-Z](-?[a-zA-Z0-9])+",
  );

  if (!email) return false;
  if (email.length > 254) return false;
  if (!emailRegex.test(email)) return false;

  let e = email.split('@');
  if (e[0].length > 64) return false;
  if (
    e[1].split('.').some(function (part) {
      return part.length > 63;
    })
  )
    return false;
  return true;
}

function validate(val: string | null): string | null {
  if (!val) return null;

  if (!isValidEmail(val)) {
    return 'Invalid email format. Please use a valid email address format (e.g., example@example.com';
  }

  return null;
}

function serialize(val: string | null): string | undefined {
  return val ? val : undefined;
}

function _deserialize(string: string | null): string | null {
  let errorMessage = validate(string);

  if (errorMessage) {
    return null;
  } else {
    return string;
  }
}

class View extends Component<typeof UserEmail> {
  <template>
    {{this.textInputValidator.asString}}
  </template>

  textInputValidator: TextInputValidator<string> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    _deserialize,
    serialize,
    validate,
  );
}

class Edit extends Component<typeof UserEmail> {
  <template>
    <BoxelInput
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
    />
  </template>

  textInputValidator: TextInputValidator<string> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    _deserialize,
    serialize,
    validate,
  );
}

export class UserEmail extends FieldDef {
  static displayName = 'User Email';
  @field email = contains(StringField, {
    description: `Email`,
  });

  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    string: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(string) as BaseInstanceType<T>;
  }
  static [queryableValue](val: string | undefined): string | undefined {
    return serialize(val ?? null);
  }

  static embedded = View;
  static atom = View;
  static edit = Edit;
}
