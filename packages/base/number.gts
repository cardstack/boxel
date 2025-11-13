import { primitive, Component, useIndexBasedKey, FieldDef } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';
import { not } from '@cardstack/boxel-ui/helpers';
import HashIcon from '@cardstack/boxel-icons/hash';
import { fieldSerializer, NumberSerializer } from '@cardstack/runtime-common';

export function deserializeForUI(value: string | number | null): number | null {
  const validationError = NumberSerializer.validate(value);
  if (validationError) {
    return null;
  }

  return NumberSerializer.deserializeSync(value);
}

export function serializeForUI(val: number | null): string | undefined {
  let serialized = NumberSerializer.serialize(val);
  if (serialized != null) {
    return String(serialized);
  }
  return undefined;
}

class View extends Component<typeof NumberField> {
  <template>
    {{@model}}
  </template>
}

export default class NumberField extends FieldDef {
  static displayName = 'Number';
  static icon = HashIcon;
  static [primitive]: number;
  static [fieldSerializer] = 'number';
  static [useIndexBasedKey]: never;
  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        @disabled={{not @canEdit}}
      />
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );
  };
}
