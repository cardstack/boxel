import { isAddress } from 'ethers';
import { primitive, Component, CardBase, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { fn } from '@ember/helper';

function validateEthereumAddress(address: string): boolean {
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
      <div class={{this.addressClass}}>
        {{@model}}
      </div>
    </template>

    get addressClass() {
      return validateEthereumAddress(this.args.model || '')
        ? 'valid-address'
        : 'invalid-address';
    }
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class={{this.addressClass}}
        @value={{@model}}
        @onInput={{fn this.validateAndSetInput @set}}
      />
    </template>

    validateAndSetInput(set: Function, value: string) {
      debugger;
      if (validateEthereumAddress(value)) {
        return set(value);
      }
    }

    get addressClass() {
      return validateEthereumAddress(this.args.model || '')
        ? 'valid-address'
        : 'invalid-address';
    }
  };
}
