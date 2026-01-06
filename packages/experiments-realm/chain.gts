import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import Link from '@cardstack/boxel-icons/link';

let CHAIN_IDS: Record<string, number> = {
  'Ethereum Mainnet': 1,
  'Gnosis Chain': 100,
  Polygon: 137,
};
let BLOCK_EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io',
  137: 'https://polygonscan.com',
  100: 'https://gnosisscan.io',
};

export class Chain extends CardDef {
  static displayName = 'Chain';
  static icon = Link;
  @field name = contains(StringField); // dropdown
  @field chainId = contains(NumberField, {
    computeVia: function (this: Chain) {
      if (!this.name) {
        return;
      }
      return CHAIN_IDS[this.name];
    },
  });
  @field blockExplorer = contains(StringField, {
    computeVia: function (this: Chain) {
      if (!this.name) {
        return;
      }
      return BLOCK_EXPLORER_URLS[CHAIN_IDS[this.name]];
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Chain) {
      return this.name;
    },
  });
  static edit = class Edit extends Component<typeof Chain> {
    <template>
      <FieldContainer @label='Chain' @tag='label'>
        <@fields.name />
      </FieldContainer>
      {{#if @model.chainId}}
        <FieldContainer @label='Chain ID'>
          <@fields.chainId />
        </FieldContainer>
      {{/if}}
    </template>
  };

  static isolated = class Isolated extends Component<typeof Chain> {
    <template>
      <div class='container'>
        <FieldContainer @label='Title'><@fields.cardTitle />
          (<@fields.cardTitle />)</FieldContainer>
        <FieldContainer @label='Chain'><@fields.cardTitle />
          (<@fields.chainId />)</FieldContainer>
        <FieldContainer @label='BlockExplorer'>
          <a href={{@model.blockExplorer}}>{{@model.blockExplorer}}</a>
        </FieldContainer>
      </div>
      <style scoped>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
  static embedded = class Embedded extends Component<typeof Chain> {
    <template>
      <FieldContainer @label='Chain'><@fields.name />
        (<@fields.chainId />)</FieldContainer>
      <FieldContainer @label='BlockExplorer'>
        <a href={{@model.blockExplorer}}>{{@model.blockExplorer}}</a>
      </FieldContainer>
    </template>
  };
}
