import { Chain } from './chain';
import {
  Card,
  contains,
  field,
  StringCard,
  Component,
} from 'https://cardstack.com/base/card-api';
import { Button, CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import { restartableTask } from 'ember-concurrency';
// @ts-ignore
import { on } from '@ember/modifier';

declare global {
  interface Window {
    ethereum: any;
  }
}

class Isolated extends Component<typeof Claim> {
  @tracked connected: any;

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
        <Button {{on 'click' this.claim}}>
          Claim
        </Button>
      {{else}}
        <Button {{on 'click' this.connectMetamask}}>
          Connect
        </Button>
      {{/if}}
    </CardContainer>
  </template>

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.initialize.perform();
    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => this.initialize.perform());
    }
  }
  private initialize = restartableTask(async () => {
    let isSameNetwork = await this.isSameNetwork();
    let isConnected = await this.isMetamaskConnected();
    this.connected = isConnected && isSameNetwork;
  });

  async isSameNetwork() {
    let metamaskChainId = await this.getChainId();
    return this.args.model.chain?.chainId == metamaskChainId;
  }

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

  // this was not bound properly here so need to use an arrow function
  connectMetamask = async () => {
    try {
      let isSameNetwork = await this.isSameNetwork();
      if (isSameNetwork) {
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        });
        if (accounts.length > 0) {
          this.connected = true;
        }
        //TODO: if user closes it says already processing eth account
      } else {
        let hexChainId = '0x' + this.args.model.chain?.chainId.toString(16);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
        // it is sufficient to assume a wallet is connected after checking it is same network
        let isSameNetwork = await this.isSameNetwork();
        if (isSameNetwork) {
          this.connected = true;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  };

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
  claim = async () => {
    console.log('claiming');
    console.log(this.args.model.card);
  };
}

export class Claim extends Card {
  static displayName = 'Claim';
  @field moduleAddress = contains(StringCard);
  @field safeAddress = contains(StringCard);
  @field explanation = contains(StringCard);
  @field signature = contains(StringCard);
  @field encoding = contains(StringCard);
  @field chain = contains(Chain);
  @field title = contains(StringCard, {
    computeVia: function (this: Claim) {
      return `Claim for ${this.safeAddress}`;
    },
  });

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
  static isolated = Isolated;
}
