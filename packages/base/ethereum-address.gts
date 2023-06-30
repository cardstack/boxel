import { isAddress, getAddress } from 'ethers';
import { primitive, Component, CardBase, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { fn } from '@ember/helper';
import { not } from '@cardstack/boxel-ui/helpers/truth-helpers';

function isEthAddress(address: string): boolean {
  try {
    return isAddress(address);
  } catch {
    return false;
  }
}

function isChecksumAddress(address: string): boolean {
  try {
    return getAddress(address) == address;
  } catch {
    return false;
  }
}

export default class EthereumAddressCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

  static edit = class Edit extends Component<typeof EthereumAddressCard> {
    <template>
      <BoxelInput
        @value={{@model}}
        @onInput={{fn this.parseInput @set}}
        @errorMessage={{this.errorMessage}}
        @invalid={{not this.isValidEthAddress}}
      />
    </template>

    get isValidEthAddress() {
      if (this.args.model == null) {
        return false;
      }
      return (
        isEthAddress(this.args.model) && isChecksumAddress(this.args.model)
      );
    }

    get errorMessage() {
      return 'Invalid Ethereum address. Please make sure it is a checksummed address.';
    }

    parseInput(set: Function, value: string) {
      return set(value);
    }
  };
}
