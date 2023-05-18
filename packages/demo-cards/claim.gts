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
  get connected() {
    return (async () => {
      let metamaskChainId = await this.getChainId();
      let isChainEqual = this.chain?.chainId == metamaskChainId;
      let isConnected = await this.isMetamaskConnected();
      return isConnected && isChainEqual;
    })();
  }

  //=======
  //metamask api

  isMetamaskInstalled() {
    let isInstalled = window.ethereum !== 'undefined';
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
    try {
      if (!this.isMetamaskInstalled()) {
        return -1;
      }
      let hexChainId = await window.ethereum.request({ method: 'eth_chainId' });
      return parseInt(hexChainId, 16);
    } catch (e) {
      return -1;
    }
  }

  //=======
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer @label='Title'><@fields.title /></FieldContainer>
        <FieldContainer @label='Explanation'><@fields.explanation
          /></FieldContainer>
        <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
        <Button>
          Look at Claim
        </Button>
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
        {{#if this.connected}}
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

    @tracked connected: any;
    constructor(owner: unknown, args: any) {
      super(owner, args);
      this.initialize();
    }

    async initialize() {
      this.connected = await this.args.model.connected;
    }
  };
}
