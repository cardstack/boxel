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
import {
  getSDK,
  Web3Provider,
  ClaimSettlementModule,
  // @ts-ignore
} from '@cardstack/cardpay-sdk';

class Isolated extends Component<typeof Claim> {
  @tracked isClaimed = false;
  claimSettlementModule: ClaimSettlementModule | undefined;
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

  async getClaimSettlementModule(): Promise<ClaimSettlementModule> {
    if (!this.claimSettlementModule) {
      let ethersProvider = new Web3Provider(window.ethereum);
      this.claimSettlementModule = await getSDK(
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
