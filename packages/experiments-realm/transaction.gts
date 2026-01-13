import {
  contains,
  field,
  Component,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import StringField from 'https://cardstack.com/base/string';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { GridContainer } from '@cardstack/boxel-ui/components';
import BigIntegerField from 'https://cardstack.com/base/big-integer';
import NumberField from 'https://cardstack.com/base/number';
import { Chain } from './chain';
import EthereumAddressField from 'https://cardstack.com/base/ethereum-address';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';

export class Transaction extends CardDef {
  static displayName = 'Transaction';
  static icon = ShieldCheckIcon;
  @field transactionHash = contains(StringField);
  @field status = contains(BooleanField);
  @field blockHash = contains(StringField);
  @field blockNumber = contains(NumberField);
  @field from = contains(EthereumAddressField);
  @field to = contains(EthereumAddressField);
  @field memo = contains(StringField);
  @field chain = linksTo(Chain);
  @field gasUsed = contains(BigIntegerField);
  @field effectiveGasPrice = contains(BigIntegerField);
  @field blockExplorerLink = contains(StringField, {
    computeVia: function (this: Transaction) {
      if (!this.chain) {
        return;
      }
      return `${this.chain.blockExplorer}/tx/${this.transactionHash}`;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Transaction) {
      if (!this.transactionHash) {
        return;
      }
      return `Txn ${this.transactionHash}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <FieldContainer @label='Title'><@fields.cardTitle /></FieldContainer>
        <FieldContainer @label='From'><@fields.from /></FieldContainer>
        <FieldContainer @label='To'><@fields.to /></FieldContainer>
        <FieldContainer @label='BlockNumber'><@fields.blockNumber
          /></FieldContainer>
        <FieldContainer @label='BlockExplorer'>
          <a href={{@model.blockExplorerLink}}>{{@model.blockExplorerLink}}</a>
        </FieldContainer>
        <FieldContainer @label='Status'><@fields.status /></FieldContainer>
        <FieldContainer @label='Memo'><@fields.memo /></FieldContainer>
      </GridContainer>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Transaction> {
    <template>
      <GridContainer class='container'>
        <FieldContainer @label='Title'><@fields.cardTitle /></FieldContainer>
        <FieldContainer @label='Status'><@fields.status /></FieldContainer>
        <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
        <FieldContainer @label='BlockHash'><@fields.blockHash
          /></FieldContainer>
        <FieldContainer @label='BlockNumber'><@fields.blockNumber
          /></FieldContainer>
        <FieldContainer @label='From'><@fields.from /></FieldContainer>
        <FieldContainer @label='To'><@fields.to /></FieldContainer>
        <FieldContainer @label='GasUsed'><@fields.gasUsed /></FieldContainer>
        <FieldContainer @label='EffectiveGasPrice'><@fields.effectiveGasPrice
          /></FieldContainer>
        <FieldContainer @label='BlockExplorer'>
          <a href={{@model.blockExplorerLink}}>{{@model.blockExplorerLink}}</a>
        </FieldContainer>

        <FieldContainer @label='Memo'><@fields.memo /></FieldContainer>
      </GridContainer>
      <style scoped>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
}
