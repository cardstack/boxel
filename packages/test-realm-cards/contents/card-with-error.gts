import { contains, field, CardDef } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Boom extends CardDef {
  @field boom = contains(StringField, {
    computeVia: function (this: Boom) {
      throw new Error(`intentional error thrown`);
    },
  });
}
