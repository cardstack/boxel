import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class BigCard extends CardDef {
  static displayName = 'Big Card';
  @field name = contains(StringField);
  @field picture = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: BigCard) {
      return this.name;
    },
  });
}
