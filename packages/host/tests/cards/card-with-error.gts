import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Boom extends CardDef {
  @field boom = contains(StringCard, {
    computeVia: function (this: Boom) {
      throw new Error(`intentional error thrown`);
    },
  });
}
