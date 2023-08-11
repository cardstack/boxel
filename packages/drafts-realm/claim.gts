import { Chain } from './chain';
import {
  Card,
  contains,
  field,
  StringCard,
  Component,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { getMetamaskResource } from './utils/resources/metamask';
import { tracked } from '@glimmer/tracking';
import { Button, FieldContainer, GridContainer } from '@cardstack/boxel-ui';
import EthereumAddressCard from 'https://cardstack.com/base/ethereum-address';

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
  LooseSingleCardDocument,
  createNewCard,
  // @ts-ignore
} from '@cardstack/runtime-common';
import { Transaction } from './transaction';

// external depedencies. wud be good to get rid of these
import type * as CardPaySDK from '@cardstack/cardpay-sdk';
// @ts-ignore
import { fn } from '@ember/helper';
import BooleanCard from 'https://cardstack.com/base/boolean';

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
  // These are meant to be `number` but they return BigNumber
  cumulativeGasUsed: any; // not sure why it returns BigNumber
  gasUsed: any; // not sure why it returns BigNumber
  effectiveGasPrice: any; // not sure why it returns BigNumber
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
  @tracked isClaimed = false;
  claimSettlementModule: CardPaySDK.ClaimSettlementModule | undefined;
  web3Provider: CardPaySDK.Web3Provider | undefined;
  getSDK: typeof CardPaySDK.getSDK | undefined;
  <template>
    <GridContainer>
      {{! include title field in template so that it can be indexed }}
      <@fields.title />
      <FieldContainer @label='Module Address.'><@fields.moduleAddress
        /></FieldContainer>
      <FieldContainer @label='Safe Address'><@fields.safeAddress
        /></FieldContainer>
      <FieldContainer @label='Explanation'><@fields.explanation
        /></FieldContainer>
      <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
      {{#if this.args.model.transaction}}
        <FieldContainer @label='Transaction'><@fields.transaction
          /></FieldContainer>
      {{/if}}
      {{#if this.connectedAndSameChain}}
        <Button
          disabled={{this.cannotClickClaimButton}}
          {{on 'click' this.claim}}
        >
          {{#if this.doClaim.isRunning}}
            Claiming...
          {{else if this.hasBeenClaimed}}
            Claim has been used
          {{else if @context.actions.createCardDirectly}}
            Claim
          {{else if this.inEnvThatCanCreateNewCard}}
            Claim
          {{else}}
            Claim (Environment does not allow card creation)
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
    </GridContainer>
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
    return this.isClaimed || !!this.args.model.transaction; //TODO:  complex logic to check if its claimed using sdk
  }

  // the chain id data of the card itself
  get chainId() {
    return this.args.model.chain?.chainId;
  }
  get inEnvThatCanCreateNewCard() {
    // this checks that the host of the card is a card creator
    // you can use methods like createNewCard
    return (globalThis as any)._CARDSTACK_CREATE_NEW_CARD ? true : false;
  }

  get cannotClickClaimButton() {
    return (
      this.hasBeenClaimed ||
      (!!!this.args.context?.actions?.createCardDirectly &&
        !this.inEnvThatCanCreateNewCard)
    );
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
      const r = await claimSettlementModule.executeSafe(
        this.args.model.moduleAddress,
        this.args.model.safeAddress,
        {
          signature: this.args.model.signature,
          encoded: this.args.model.encoding,
        }
      );

      if (r) {
        await this.createCardFromReceipt(r, this.args.model.chain);
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

  @action
  private claim() {
    this.doClaim.perform();
  }

  @action
  private connectMetamask() {
    this.metamask.doConnectMetamask.perform(this.chainId);
  }
  private async createCardFromReceipt(r: TransactionReceipt, c: Chain) {
    try {
      let realmUrl = this.args.model[realmURL];
      if (!realmUrl) {
        throw new Error('Realm is undefined');
      }
      const transactionCardRef: CardRef = {
        module: `${realmUrl.href}transaction`,
        name: 'Transaction',
      };

      let transactionCardAttributes = {
        transactionHash: r.transactionHash,
        status: r.status,
        blockHash: r.blockHash,
        blockNumber: r.blockNumber,
        from: r.from,
        to: r.to,
        // Workaround. Runtime doesn't correspond to types so we check type here
        // We transform the BigNumber into a string which is expected serialized form
        // It's one extra step to convert .toBigInt and then serialize it from there
        gasUsed: r.gasUsed._isBigNumber ? r.gasUsed.toString() : r.gasUsed,
        effectiveGasPrice: r.effectiveGasPrice._isBigNumber
          ? r.effectiveGasPrice.toString()
          : r.effectiveGasPrice,
      };

      let transactionDoc: LooseSingleCardDocument = {
        data: {
          attributes: transactionCardAttributes,
          relationships: {
            chain: {
              links: {
                self: c.id,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmUrl.href}transaction`,
              name: 'Transaction',
            },
          },
        },
      };
      if (this.args.context?.actions?.createCardDirectly) {
        // create using operator mode action
        await this.args.context.actions.createCardDirectly(
          transactionDoc,
          undefined
        );
      } else {
        // create using create card modal
        await createNewCard(transactionCardRef, undefined, {
          doc: transactionDoc,
        });
      }
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

class Embedded extends Component<typeof Claim> {
  get claimButtonDisabled() {
    return !!!this.args.context?.actions?.viewCard;
  }
  @action openCard(card: Partial<Claim> | undefined) {
    if (card) {
      this.args.context?.actions?.viewCard(card as Card);
    }
  }

  <template>
    <GridContainer>
      <FieldContainer @label='Title'><@fields.title /></FieldContainer>
      <FieldContainer @label='Explanation'><@fields.explanation
        /></FieldContainer>
      <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
      <FieldContainer @label='Already Claimed?'>
        <@fields.hasBeenClaimed />
      </FieldContainer>
      <Button
        disabled={{this.claimButtonDisabled}}
        {{on 'click' (fn this.openCard this.args.model)}}
      >
        {{#if this.claimButtonDisabled}}
          View Claim (Environment does not allow card viewing)
        {{else}}
          View Claim
        {{/if}}
      </Button>
    </GridContainer>
  </template>
}

export class Claim extends Card {
  static displayName = 'Claim';
  @field moduleAddress = contains(EthereumAddressCard);
  @field safeAddress = contains(EthereumAddressCard);
  @field explanation = contains(StringCard);
  @field signature = contains(StringCard);
  @field encoding = contains(StringCard);
  @field chain = linksTo(Chain);
  @field title = contains(StringCard, {
    computeVia: function (this: Claim) {
      return `Claim for ${this.safeAddress}`;
    },
  });
  @field transaction = linksTo(() => Transaction); // this field is populated after a claim
  @field hasBeenClaimed = contains(BooleanCard, {
    computeVia: function (this: Claim) {
      return !!this.transaction;
    },
  });

  static embedded = Embedded;
  static isolated = Isolated;
}
