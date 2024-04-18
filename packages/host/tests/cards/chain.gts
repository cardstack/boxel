import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import NumberCard from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

let CHAIN_IDS: Record<string, number> = {
  'Ethereum Mainnet': 1,
  'Gnosis Chain': 100,
  Polygon: 137,
};
export class Chain extends CardDef {
  @field name = contains(StringField);
  @field chainId = contains(NumberCard, {
    computeVia: function (this: Chain) {
      return CHAIN_IDS[this.name];
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Chain) {
      return this.name;
    },
  });
  @field description = contains(StringField, {
    computeVia: function (this: Chain) {
      return `Chain ${this.chainId}`;
    },
  });
  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: Chain) {
      return `${this.name}-icon.png`;
    },
  });
}
