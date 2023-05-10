import {
  contains,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { FieldContainer } from '@cardstack/boxel-ui';

let CHAIN_IDS: Record<string, number> = {
  'Ethereum Mainnet': 1,
  'Gnosis Chain': 100,
  Polygon: 137,
};

export class Chain extends Card {
  static displayName = 'Chain';
  @field name = contains(StringCard); // dropdown
  @field chainId = contains(IntegerCard, {
    computeVia: function (this: Chain) {
      return CHAIN_IDS[this.name];
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
  static embedded = class Embedded extends Component<typeof Chain> {
    <template>
      <@fields.name /> ({{@model.chainId}})
    </template>
  };
  static isolated = class Isolated extends Component<typeof Chain> {
    <template>
      <div><@fields.name /> ({{@model.chainId}})</div>
    </template>
  };
}
