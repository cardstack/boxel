import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  useIndexBasedKey,
  BaseInstanceType,
  serialize,
  deserialize,
  BaseDefConstructor,
  queryableValue,
  FieldDef,
} from './card-api';
import BoxelInput from '@cardstack/boxel-ui/components/input';
import { TextInputFilter, DeserializedResult } from './text-input-filter';

function isChecksumAddress(address: string): boolean {
  return getAddress(address) === address;
}

function _deserialize(
  address: string | null | undefined,
): DeserializedResult<string> {
  if (address == null || address == undefined) {
    return { value: null };
  }
  const validations = [
    // desc order of priority
    {
      validate: (address: string) => isAddress(address),
      errorMessage: 'Not a valid Ethereum address.',
    },
    {
      validate: (address: string) => isChecksumAddress(address),
      errorMessage: 'Not a checksummed address.',
    },
  ];

  for (let validation of validations) {
    if (!validation.validate(address)) {
      return { value: null, errorMessage: validation.errorMessage };
    }
  }
  return { value: address };
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
      @invalid={{this.textInputFilter.isInvalid}}
    />
  </template>

  textInputFilter: TextInputFilter<string> = new TextInputFilter(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    _deserialize,
  );
}

function _serialize(val: string): string {
  return val;
}

export default class EthereumAddressField extends FieldDef {
  static displayName = 'EthereumAddress';
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static [serialize](val: string) {
    return _serialize(val);
  }

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    address: any,
  ): Promise<BaseInstanceType<T>> {
    return _deserialize(address).value as BaseInstanceType<T>;
  }

  static [queryableValue](val: string | undefined): string | undefined {
    if (val) {
      return EthereumAddressField[serialize](val);
    } else {
      return undefined;
    }
  }

  static embedded = View;
  static atom = View;
  static edit = Edit;
}
