import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  deserialize,
  BaseInstanceType,
  BaseDefConstructor,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { TextInputValidator } from './text-input-validator';

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
  static [queryableValue](val: string | undefined): string | undefined {
    return serialize(val ?? null);
  }
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
