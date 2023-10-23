import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import NumberCard from 'https://cardstack.com/base/number';
import { FieldContainer } from '@cardstack/boxel-ui/components';

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
  @field name = contains(StringCard); // dropdown
  @field chainId = contains(NumberCard, {
    computeVia: function (this: Chain) {
      return CHAIN_IDS[this.name];
    },
  });
  @field blockExplorer = contains(StringCard, {
    computeVia: function (this: Chain) {
      return BLOCK_EXPLORER_URLS[CHAIN_IDS[this.name]];
    },
  });
  @field title = contains(StringCard, {
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
      <FieldContainer @label='Title'><@fields.title />
        (<@fields.title />)</FieldContainer>
      <FieldContainer @label='Chain'><@fields.title />
        (<@fields.chainId />)</FieldContainer>
      <FieldContainer @label='BlockExplorer'>
        <a href={{@model.blockExplorer}}>{{@model.blockExplorer}}</a>
      </FieldContainer>
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
