import { Chain } from './chain';
import {
  Card,
  contains,
  field,
  StringCard,
  Component,
  linksTo,
  realmURL,
  // isSaved,
  // createFromSerialized,
} from 'https://cardstack.com/base/card-api';
import { getMetamaskResource } from './utils/resources/metamask';
import { TempCardService } from './utils/services/temp-card-service';
import { tracked } from '@glimmer/tracking';
import { Button, FieldContainer } from '@cardstack/boxel-ui';
// import { merge } from 'lodash';

// @ts-ignore
import { registerDestructor } from '@ember/destroyable';
// @ts-ignore
import { enqueueTask, restartableTask } from 'ember-concurrency';
// @ts-ignore
import { on } from '@ember/modifier';
// @ts-ignore
import { action } from '@ember/object';
import {
  type CardRef,
  createNewCard,
  LooseCardResource,
  // LooseSingleCardDocument,
  // @ts-ignore
} from '@cardstack/runtime-common';
import { Transaction } from './transaction';

// external depedencies. wud be good to get rid of these
import type * as CardPaySDK from '@cardstack/cardpay-sdk';
// import { BigNumber } from 'https://unpkg.com/@ethersproject/bignumber@5.7.0/lib.esm/index.js';

//transaciton receipt type from the SDK
export interface TransactionReceipt {
  status: boolean;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  blockNumber: number;
  from: string;
  to: string;
  contractAddress?: string;
  cumulativeGasUsed: any;
  gasUsed: any;
  effectiveGasPrice: number;
  logs: Log[];
  logsBloom: string;
  events?: {
    [eventName: string]: EventLog;
  };
}

export interface EventLog {
  event: string;
  address: string;
  returnValues: any;
  logIndex: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  raw?: { data: string; topics: any[] };
}

export interface Log {
  address: string;
  data: string;
  topics: string[];
  logIndex: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
}
//@ts-ignore
interface SuccessfulTransactionReceipt extends TransactionReceipt {
  status: true;
}

class Isolated extends Component<typeof Claim> {
  cardService = new TempCardService();
  @tracked isClaimed = false;
  claimSettlementModule: CardPaySDK.ClaimSettlementModule | undefined;
  web3Provider: CardPaySDK.Web3Provider | undefined;
  getSDK: typeof CardPaySDK.getSDK | undefined;
  <template>
    <div class='demo-card'>
      <FieldContainer @label='Module Address.'><@fields.moduleAddress
        /></FieldContainer>
      <FieldContainer @label='Safe Address'><@fields.safeAddress
        /></FieldContainer>
      <FieldContainer @label='Explanation'><@fields.explanation
        /></FieldContainer>
      <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
      {{#if this.connectedAndSameChain}}
        <Button disabled={{this.isNotClaimable}} {{on 'click' this.claim}}>
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
    </div>
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
  get inEnvThatCanCreateNewCard() {
    return (globalThis as any)._CARDSTACK_CREATE_NEW_CARD ? true : false;
  }

  get isNotClaimable() {
    return this.hasBeenClaimed || !this.inEnvThatCanCreateNewCard;
  }

  private doClaim = restartableTask(async () => {
    try {
      // @ts-ignore
      let claimSettlementModule = await this.getClaimSettlementModule();
      if (
        !this.args.model.moduleAddress ||
        !this.args.model.signature ||
        !this.args.model.safeAddress ||
        !this.args.model.signature ||
        !this.args.model.encoding ||
        !this.args.model.chain
      ) {
        throw new Error('Claim fields not ready');
      }

      const r = {
        transactionHash:
          '0xcc29758868dea3cfd9fe76440a01ad0ab7fae61383f32fe18abc4f32c5a02c54',
        status: true,
        blockHash:
          '0xfa259a22c65690c95d59cf976db713cfe0a29142a7e3dae19e0af116fecf7aa3',
        blockNumber: 43864856,
        from: '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b',
        to: '0xEDC43a390C8eE324cC9d21C93C55c04bD6B8257f',
      } as TransactionReceipt;
      if (r) {
        await this.createTransactionCard(r);
        console.log('You have succesfully claimed your reward!');
        this.isClaimed = true;
      }
    } catch (e: any) {
      if (e.reason == 'Already claimed') {
        this.isClaimed = true;
      }
      throw e;
    }
  });

  private createCardFromReceipt = restartableTask(async (r: any) => {
    let realmUrl = this.args.model[realmURL];
    if (!realmUrl) {
      throw new Error('Realm is undefined');
    }
    if (
      !this.args.model.moduleAddress ||
      !this.args.model.signature ||
      !this.args.model.safeAddress ||
      !this.args.model.signature ||
      !this.args.model.encoding ||
      !this.args.model.chain
    ) {
      throw new Error('Claim fields not ready');
    }

    const transactionCardRef: CardRef = {
      module: `${realmUrl.href}transaction`,
      name: 'Transaction',
    };
    let cardWithData: LooseCardResource = {
      attributes: r,
      relationships: {
        chain: {
          links: {
            self: this.args.model.chain.id,
          },
        },
      },
    };

    // let doc: LooseSingleCardDocument = {
    //   data: { meta: { adoptsFrom: transactionCardRef } },
    // };
    // doc.data = merge(doc.data, cardWithData);
    // doc.data.attributes.memo = 'u suck';
    // let c = await createFromSerialized(
    //   doc.data as LooseCardResource,
    //   doc,
    //   undefined,
    //   undefined
    // );
    // console.log('====');
    // console.log(c);

    // calls create card modal
    let newCard = await createNewCard(
      transactionCardRef,
      undefined,
      cardWithData
    );
    // you need to save the card
    if (newCard) {
      this.args.model.transaction = newCard;
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
  private async createTransactionCard(r: TransactionReceipt) {
    let realmUrl = this.args.model[realmURL];
    if (!realmUrl) {
      throw new Error('Realm is undefined');
    }
    // @ts-ignore
    let cardData = {
      data: {
        type: 'card',
        attributes: {
          transactionHash: r.transactionHash,
          status: r.status,
          blockHash: r.blockHash,
          blockNumber: r.blockNumber,
          from: r.from,
          to: r.to,
          // gasUsed: r.gasUsed,
          // BigNumber.isBigNumber(r.gasUsed)
          //   ? r.gasUsed.toString()
          //   : r.gasUsed,
          // effectiveGasPrice: r.effectiveGasPrice,
          // BigNumber.isBigNumber(r.effectiveGasPrice)
          //   ? r.effectiveGasPrice.toString()
          //   : r.effectiveGasPrice,
        },
        meta: {
          adoptsFrom: {
            module: `${realmUrl.href}transaction`,
            name: 'Transaction',
          },
        },
      },
    };
    try {
      this.createCardFromReceipt.perform(r);
    } catch (e: any) {
      throw e;
    }
  }

  private async loadCardpaySDK() {
    // we load this import dynamically from an unpkg url.
    // This will prevent SLOW load times and INCOMPATIBLE browser apis that fastboot will complain about (e.g. XMLHtppRequest)
    const { getSDK, Web3Provider } = (await import(
      // @ts-ignore
      'https://unpkg.com/@cardstack/cardpay-sdk@1.0.53/dist/browser.js' // access file directly to prevent needing to change package.json fields like browser since other apps are consuming the sdk too
    )) as typeof CardPaySDK;
    this.web3Provider = new Web3Provider(window.ethereum);
    this.getSDK = getSDK;
  }

  private async getClaimSettlementModule(): Promise<CardPaySDK.ClaimSettlementModule> {
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
  @field transaction = linksTo(() => Transaction); // this field is populated after a claim

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='demo-card'>
        <FieldContainer @label='Title'><@fields.title /></FieldContainer>
        <FieldContainer @label='Explanation'><@fields.explanation
          /></FieldContainer>
        <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
        <Button>
          Look at Claim
        </Button>
      </div>
    </template>
  };
  static isolated = Isolated;
}
