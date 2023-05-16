import { Chain } from './chain';
import {
  Card,
  contains,
  field,
  StringCard,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import { Button, CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import BooleanCard from 'https://cardstack.com/base/boolean';

declare global {
  interface Window {
    ethereum: any;
  }
}

export class Claim extends Card {
  static displayName = 'Claim';
  @field
  moduleAddress = contains(StringCard);
  @field
  safeAddress = contains(StringCard);
  @field
  explanation = contains(StringCard);
  @field
  signature = contains(StringCard);
  @field
  encoding = contains(StringCard);
  @field
  chain = linksTo(() => Chain);
  @field title = contains(StringCard, {
    computeVia: function (this: Claim) {
      return `Claim for ${this.safeAddress}`;
    },
  });
  @field connected = contains(BooleanCard, {
    computeVia: async function (this: Claim) {
      let metamaskChainId = await this.getChainId();
      let isChainEqual = this.chain?.chainId == metamaskChainId;
      return (await this.isMetamaskConnected()) && isChainEqual;
    },
  });

  //=======
  //metamask api

  async isMetamaskInstalled() {
    let isInstalled = window.ethereum !== 'undefined';
    console.log(`MetaMask is installed: ${isInstalled}`);
    return isInstalled;
  }

  async isMetamaskConnected() {
    try {
      if (!this.isMetamaskInstalled()) {
        return false;
      }
      let accounts = await window.ethereum.request({ method: 'eth_accounts' });
      return accounts.length > 0;
    } catch (e) {
      return false;
    }
  }

  async connectMetamask() {
    try {
      return await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
    } catch (e) {
      return false;
    }
  }

  // chainId and networkId are not the same. You can get networkId using the metamask api.
  async getChainId() {
    if (!this.isMetamaskInstalled()) {
      return -1;
    }
    let hexChainId = await window.ethereum.request({ method: 'eth_chainId' });
    return parseInt(hexChainId, 16);
  }

  //=======
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer @label='Title'><@fields.title /></FieldContainer>
        <FieldContainer @label='Explanation'><@fields.explanation
          /></FieldContainer>
        <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
        <FieldContainer @label='Connected'><@fields.connected
          /></FieldContainer>
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer @label='Module Address.'><@fields.moduleAddress
          /></FieldContainer>
        <FieldContainer @label='Safe Address'><@fields.safeAddress
          /></FieldContainer>
        <FieldContainer @label='Explanation'><@fields.explanation
          /></FieldContainer>
        <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
        <FieldContainer @label='Connected'><@fields.connected
          /></FieldContainer>
        {{#if @model.connected}}
          <Button>
            Claim
          </Button>
        {{else}}
          <Button>
            Connect
          </Button>

        {{/if}}
      </CardContainer>
    </template>
  };
}
