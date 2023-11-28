import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  deserialize,
  BaseInstanceType,
  BaseDefConstructor,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';

function isChecksumAddress(address: string): boolean {
  return getAddress(address) === address;
}

function validate(value?: string | null): string | null {
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

function _deserialize(string?: string | null): string | null | undefined {
  let errorMessage = validate(string);

  if (errorMessage) {
    return null;
  } else {
    return string;
  }
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
    _deserialize,
    serialize,
    validate,
  );
}

export default class EthereumAddressField extends FieldDef {
  static displayName = 'EthereumAddress';
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    address: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(address) as BaseInstanceType<T>;
  }
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
