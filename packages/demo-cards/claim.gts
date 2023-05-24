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
import { enqueueTask, restartableTask } from 'ember-concurrency';
// @ts-ignore
import { on } from '@ember/modifier';
// @ts-ignore
import { action } from '@ember/object';

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
          {{#if this.doClaim.isRunning}}
            Claiming...
          {{else}}
            Claim
          {{/if}}
        </Button>
      {{else}}
        <Button {{on 'click' this.connectMetamask}}>
          {{#if this.doConnectMetamask.isRunning}}
            Connecting...
          {{else}}
            Connect
          {{/if}}
        </Button>
      {{/if}}
    </CardContainer>
  </template>

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.initialize.perform();
    if (this.isMetamaskInstalled()) {
      window.ethereum.on('chainChanged', (chainId: string) => {
        this.connected =
          parseInt(chainId, 16) == this.args.model.chain?.chainId;
        window.location.reload(); // metamask recommends to reload page
      });
    }
  }
  private initialize = enqueueTask(async () => {
    let isSameNetwork = this.isSameNetwork();
    let isConnected = await this.isMetamaskConnected();
    this.connected = isConnected && isSameNetwork;
  });

  isSameNetwork() {
    let metamaskChainId = this.getChainId();
    return this.args.model.chain?.chainId == metamaskChainId;
  }

  isMetamaskInstalled() {
    return window.ethereum !== 'undefined';
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

  private doConnectMetamask = restartableTask(async () => {
    try {
      let isSameNetwork = this.isSameNetwork();
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
      }
      return true;
    } catch (e) {
      return false;
    }
  });

  @action
  private connectMetamask() {
    this.doConnectMetamask.perform();
  }

  getChainId() {
    try {
      if (!this.isMetamaskInstalled()) {
        return -1;
      }
      let hexChainId = window.ethereum.chainId;
      return parseInt(hexChainId, 16);
    } catch (e) {
      return -1;
    }
  }

  private doClaim = restartableTask(async () => {
    console.log('claiming');
    return true;
  });

  @action
  private claim() {
    this.doClaim.perform();
  }
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
