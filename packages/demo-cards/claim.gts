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
// @ts-ignore
import { getSDK, Web3Provider } from '@cardstack/cardpay-sdk';

declare global {
  interface Window {
    ethereum: any;
  }
}

class Isolated extends Component<typeof Claim> {
  @tracked connected: any;
  @tracked claimOutput: string = '';

  <template>
    <CardContainer class='demo-card' @displayBoundaries={{true}}>
      <FieldContainer @label='Module Address.'><@fields.moduleAddress
        /></FieldContainer>
      <FieldContainer @label='Safe Address'><@fields.safeAddress
        /></FieldContainer>
      <FieldContainer @label='Explanation'><@fields.explanation
        /></FieldContainer>
      <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
      <FieldContainer @label='Claim Result'>
        {{this.claimOutput}}
      </FieldContainer>
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

  getInfoByChain(hexChainId: string) {
    try {
      const addresses = {
        '0x5': {
          programAdminSafe: '0xa2A823a224DED27fe2e25664e7eE70331E560aC4',
          moduleAddress: '0x45f46A4666df334D1600aa1D0a5a1C3626983870', // not master copy. Its the proxy
          nft: '0x9551D865059dfEB352Ca278bdad35c31a84248f0',
          token: '0x95093b8836ED53B4594EC748995E45b0Cd2b1389', // CTST
        },
        '0x89': {
          programAdminSafe: '0x7289cf9639f57d7D76a329Be3bD8F518f966CF1A',
          moduleAddress: '0xCF726Ff23Fb821e8aC9253f2ad663E96A0Cb5036',
          nft: '0x46a160d7831Bf361E5faa14c1e523758840d0116',
          token: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USD Stablecoin 6 decimal places
        },
        '0x1': {
          programAdminSafe: '',
          moduleAddress: '',
          nft: '0x1B20DE8891d19F98323f275690edF6713435844a',
          token: '0x954b890704693af242613edEf1B603825afcD708', // CARD
        },
      };
      return addresses[hexChainId as keyof typeof addresses]['moduleAddress'];
    } catch (e) {
      return null;
    }
  }

  private doClaim = restartableTask(async () => {
    let ethersProvider = new Web3Provider(window.ethereum);
    let claimSettlementModule = await getSDK(
      'ClaimSettlementModule',
      ethersProvider
    );
    const r = await claimSettlementModule.executeSafe(
      this.args.model.moduleAddress,
      this.args.model.safeAddress,
      {
        signature: this.args.model.signature,
        encoded: this.args.model.encoding,
      }
    );
    this.claimOutput = r;
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
