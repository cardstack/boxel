import { contains, field, Card } from 'https://cardstack.com/base/card-api';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';

let CHAIN_IDS: Record<string, number> = {
  'Ethereum Mainnet': 1,
  'Gnosis Chain': 100,
  Polygon: 137,
};
export class Chain extends Card {
  @field name = contains(StringCard);
  @field chainId = contains(NumberCard, {
    computeVia: function (this: Chain) {
      return CHAIN_IDS[this.name];
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Chain) {
      return this.name;
    },
  });
}
