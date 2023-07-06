import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  CardBase,
  useIndexBasedKey,
  CardBaseConstructor,
  CardInstanceType,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { FieldInputEditor } from './field-input-editor';
import { deserialize, serializePrimitive } from './card-api';

function isEthAddress(address: string): boolean {
  try {
    return isAddress(address);
  } catch {
    return false;
  }
}

function isChecksumAddress(address: string): boolean {
  try {
    return getAddress(address) === address;
  } catch {
    return false;
  }
}

function _serialize(val: string | null): string | undefined {
  if (!val) {
    return undefined;
  }
  return val;
}

function _deserialize(address: string | null): string | undefined {
  if (!address) {
    return undefined;
  }
  if (isEthAddress(address) && isChecksumAddress(address)) {
    return address;
  }
  return undefined;
}

class Edit extends Component<typeof EthereumAddressCard> {
  <template>
    <BoxelInput
      @value={{this.validatorEditor.current}}
      @onInput={{this.validatorEditor.parseInput}}
      @errorMessage={{this.validatorEditor.errorMessage}}
      @invalid={{this.validatorEditor.isInvalid}}
    />
  </template>

  validatorEditor = new FieldInputEditor(
    () => this.args.model,
    (inputVal: any) => this.args.set(inputVal),
    undefined,
    _deserialize, //TODO fix types
    'Invalid Ethereum address. Please make sure it is a checksummed address.;'
  );
}

export default class EthereumAddressCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static async [deserialize]<T extends CardBaseConstructor>(
    this: T,
    address: any
  ): Promise<CardInstanceType<T>> {
    return _deserialize(address) as CardInstanceType<T>;
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

  static edit = Edit;
}
