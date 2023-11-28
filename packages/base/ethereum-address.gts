import { isAddress, getAddress } from 'ethers';
import { primitive, Component, useIndexBasedKey, FieldDef } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';

function isChecksumAddress(address: string): boolean {
  return getAddress(address) === address;
}

function validate(value: string | null): string | null {
  if (value == null || value === '') {
    return null;
  }

  if (!isAddress(value)) {
    return 'Invalid Ethereum address';
  }

  if (!isChecksumAddress(value)) {
    return 'Not a checksummed address';
  }

  return null;
}

function serialize(val: string): string {
  return val;
}

function deserialize(string?: string | null): string | null {
  return string || null;
}

class View extends Component<typeof EthereumAddressField> {
  <template>
    {{@model}}
  </template>
}

class Edit extends Component<typeof EthereumAddressField> {
  <template>
    <BoxelInput
      @value={{this.textInputFilter.asString}}
      @onInput={{this.textInputFilter.onInput}}
      @errorMessage={{this.textInputFilter.errorMessage}}
      @state={{if this.textInputFilter.isInvalid 'invalid' 'none'}}
    />
  </template>

  textInputFilter: TextInputValidator<string> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    deserialize,
    serialize,
    validate,
  );
}

export default class EthereumAddressField extends FieldDef {
  static displayName = 'EthereumAddress';
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static embedded = View;
  static atom = View;
  static edit = Edit;
}
