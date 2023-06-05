import { Chain } from './chain';
import {
  Card,
  contains,
  field,
  StringCard,
  Component,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { getMetamaskResource } from './utils/resources/metamask';
import { tracked } from '@glimmer/tracking';
import { Button, CardContainer, FieldContainer } from '@cardstack/boxel-ui';
// @ts-ignore
import { enqueueTask, restartableTask } from 'ember-concurrency';
// @ts-ignore
import { on } from '@ember/modifier';
// @ts-ignore
import { action } from '@ember/object';
// @ts-ignore
import { getSDK, Web3Provider } from '@cardstack/cardpay-sdk';

class Isolated extends Component<typeof Claim> {
  <template>
    <CardContainer class='demo-card' @displayBoundaries={{true}}>
      <FieldContainer @label='Module Address.'><@fields.moduleAddress
        /></FieldContainer>
      <FieldContainer @label='Safe Address'><@fields.safeAddress
        /></FieldContainer>
      <FieldContainer @label='Explanation'><@fields.explanation
        /></FieldContainer>
      <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
      {{#if this.connectedAndSameChain}}
        <Button {{on 'click' this.claim}}>
          {{#if this.doClaim.isRunning}}
            Claiming...
          {{else}}
            Claim
          {{/if}}
        </Button>
      {{else}}
        <Button {{on 'click' this.connectMetamask}}>
          {{#if this.metamask.doConnectMetamask.isRunning}}
            Connecting...
          {{else}}
            Connect
          {{/if}}
        </Button>
      {{/if}}
    </CardContainer>
  </template>

  // chainId is not explicitly passed to resource
  // but, the resource is recreated everytime this.chainId changes
  metamask = getMetamaskResource(this, () => {
    this.chainId;
  });

  get connectedAndSameChain() {
    return this.chainId == this.metamask.chainId && this.metamask.connected;
  }

  // the chain id data of the card itself
  get chainId() {
    return this.args.model.chain?.chainId;
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
    console.log(r); //TODO: should be replaced with a transaction card being created
  });

  @action
  private claim() {
    this.doClaim.perform();
  }

  @action
  private connectMetamask() {
    this.metamask.doConnectMetamask.perform(this.chainId);
  }
}

export class Claim extends Card {
  static displayName = 'Claim';
  @field moduleAddress = contains(StringCard);
  @field safeAddress = contains(StringCard);
  @field explanation = contains(StringCard);
  @field signature = contains(StringCard);
  @field encoding = contains(StringCard);
  @field chain = linksTo(() => Chain);
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

function getInfoByChain(hexChainId: string) {
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
