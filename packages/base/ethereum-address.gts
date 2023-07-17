import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  CardBase,
  useIndexBasedKey,
  CardInstanceType,
  serialize,
  deserialize,
  CardBaseConstructor,
  queryableValue,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { TextInputFilter, DeserializedResult } from './text-input-filter';

function isChecksumAddress(address: string): boolean {
  return getAddress(address) === address;
}

function _deserialize(
  address: string | null | undefined
): DeserializedResult<string> {
  if (!address) {
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

class Edit extends Component<typeof EthereumAddressCard> {
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
    _deserialize
  );
}

function _serialize(val: string | null | undefined): string | undefined {
  if (!val) {
    return;
  }
  return val;
}

export default class EthereumAddressCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static [serialize](val: string) {
    return _serialize(val);
  }

  static async [deserialize]<T extends CardBaseConstructor>(
    this: T,
    address: any
  ): Promise<CardInstanceType<T>> {
    return _deserialize(address).value as CardInstanceType<T>;
  }

  static [queryableValue](val: string | undefined): string | undefined {
    if (val) {
      return EthereumAddressCard[serialize](val);
    } else {
      return undefined;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

  static edit = Edit;
}
