import { isAddress } from 'ethers';
import { primitive, Component, CardBase, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { fn } from '@ember/helper';
import { not } from '@cardstack/boxel-ui/helpers/truth-helpers';

function isEthAddress(address: string): boolean {
  // this validates the input field is an eth address
  // it also checks that the address is checksummed
  // note: we do not checksum the address for the user but only indicate of the missing checksum
  try {
    return isAddress(address);
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
      return isEthAddress(this.args.model);
    }

    get errorMessage() {
      return 'Invalid Ethereum address. Please make sure it is a checksummed address.';
    }

    parseInput(set: Function, value: string) {
      return set(value);
    }
  };
}
