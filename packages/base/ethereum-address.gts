import { isAddress, getAddress } from 'ethers';
import {
  primitive,
  Component,
  CardBase,
  useIndexBasedKey,
  CardInstanceType,
  deserialize,
  CardBaseConstructor,
} from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { FieldInputEditor, DeserializedResult } from './field-input-editor';

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

function _deserialize(address: string | null): DeserializedResult<string> {
  if (!address) {
    return { value: null, errorMessage: 'eth address undefined' };
  }
  const validations = [
    {
      validate: (address: string) => isChecksumAddress(address),
      errorMessage: 'Not a checksummed address.',
    },
    {
      validate: (address: string) => isEthAddress(address),
      errorMessage: 'Not a valid Ethereum address.',
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
      @value={{this.validatorEditor.current}}
      @onInput={{this.validatorEditor.parseInput}}
      @errorMessage={{this.validatorEditor.errorMessage}}
      @invalid={{this.validatorEditor.isInvalid}}
    />
  </template>

  validatorEditor: FieldInputEditor<string> = new FieldInputEditor(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal),
    undefined,
    _deserialize
  );
}

export default class EthereumAddressCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static async [deserialize]<T extends CardBaseConstructor>(
    this: T,
    address: any
  ): Promise<CardInstanceType<T>> {
    return _deserialize(address).value as CardInstanceType<T>;
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

  static edit = Edit;
}
