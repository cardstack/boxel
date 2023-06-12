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
import type {
  getSDK,
  Web3Provider,
  ClaimSettlementModule,
} from '@cardstack/cardpay-sdk';

class Isolated extends Component<typeof Claim> {
  @tracked isClaimed = false;
  // these is no good way to load types from a URL
  claimSettlementModule: ClaimSettlementModule | undefined;
  web3Provider: typeof Web3Provider | undefined;
  getSDK: typeof getSDK | undefined;
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
        <Button disabled={{this.hasBeenClaimed}} {{on 'click' this.claim}}>
          {{#if this.doClaim.isRunning}}
            Claiming...
          {{else if this.hasBeenClaimed}}
            Claim has been used
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

  get hasBeenClaimed() {
    return this.isClaimed; //TODO:  complex logic to check if its claimed using sdk
  }

  // the chain id data of the card itself
  get chainId() {
    return this.args.model.chain?.chainId;
  }

  private doClaim = restartableTask(async () => {
    try {
      let claimSettlementModule = await this.getClaimSettlementModule();
      if (
        !this.args.model.moduleAddress ||
        !this.args.model.signature ||
        !this.args.model.safeAddress ||
        !this.args.model.signature ||
        !this.args.model.encoding
      ) {
        throw new Error('Claim fields not ready');
      }
      const r = await claimSettlementModule.executeSafe(
        this.args.model.moduleAddress,
        this.args.model.safeAddress,
        {
          signature: this.args.model.signature,
          encoded: this.args.model.encoding,
        }
      );
      if (r) {
        console.log('You have succesfully claimed your reward!');
        console.log(r); //TODO: should be replaced with a transaction card being created
        this.isClaimed = true;
      }
    } catch (e: any) {
      if (e.reason == 'Already claimed') {
        this.isClaimed = true;
      }
      throw e;
    }
  });

  @action
  private claim() {
    this.doClaim.perform();
  }

  @action
  private connectMetamask() {
    this.metamask.doConnectMetamask.perform(this.chainId);
  }

  private async loadCardpaySDK() {
    // we load this import dynamically from an unpkg url.
    // This will prevent SLOW load times and INCOMPATIBLE browser apis that fastboot will complain about (e.g. XMLHtppRequest)
    const { getSDK, Web3Provider } = await import(
      // @ts-ignore
      'https://unpkg.com/@cardstack/cardpay-sdk@1.0.53/dist/browser.js'
    );
    this.web3Provider = new Web3Provider(window.ethereum);
    this.getSDK = getSDK;
  }

  private async getClaimSettlementModule(): Promise<ClaimSettlementModule> {
    if (!this.claimSettlementModule) {
      await this.loadCardpaySDK();
      if (!this.getSDK || !this.web3Provider) {
        throw new Error('Claim Settlement Module not ready');
      }
      let ethersProvider = this.web3Provider;
      this.claimSettlementModule = await this.getSDK(
        'ClaimSettlementModule',
        ethersProvider
      );
    }
    return this.claimSettlementModule;
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
