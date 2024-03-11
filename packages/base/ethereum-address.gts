import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  useIndexBasedKey,
  FieldDef,
  deserialize,
  InstanceType,
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

export default class EthereumAddressField extends FieldDef {
  static displayName = 'EthereumAddress';
  @field value = primitive<string>();
  static [useIndexBasedKey]: never;
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    address: any,
  ): Promise<InstanceType<T>> {
    return _deserialize(address) as InstanceType<T>;
  }
  static [queryableValue](val: string | undefined): string | undefined {
    return serialize(val ?? null);
  }
  static embedded = View;
  static atom = View;
  static edit = Edit;
}
