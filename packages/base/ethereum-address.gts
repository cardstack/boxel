import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  serialize,
  deserialize,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';
import { not } from '@cardstack/boxel-ui/helpers';
import CurrencyEthereum from '@cardstack/boxel-icons/currency-ethereum';
import { EthereumAddressSerializer } from '@cardstack/runtime-common';

function isChecksumAddress(address: string): boolean {
  return getAddress(address) === address;
}

function validate(value: string | null): string | null {
  if (!value) {
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

function deserializeForUI(value: string | null): string | null {
  const validationError = validate(value);
  if (validationError) {
    return null;
  }

  return EthereumAddressSerializer.deserializeSync(value);
}

class View extends Component<typeof EthereumAddressField> {
  <template>
    {{@model}}
  </template>
}

class Edit extends Component<typeof EthereumAddressField> {
  <template>
    <BoxelInput
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
      @disabled={{not @canEdit}}
    />
  </template>

  textInputValidator: TextInputValidator<string> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    deserializeForUI,
    EthereumAddressSerializer.serialize,
    validate,
  );
}

export default class EthereumAddressField extends FieldDef {
  static displayName = 'EthereumAddress';
  static icon = CurrencyEthereum;
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static [serialize] = EthereumAddressSerializer.serialize;
  static [deserialize] = EthereumAddressSerializer.deserialize;
  static [queryableValue] = EthereumAddressSerializer.queryableValue;
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
