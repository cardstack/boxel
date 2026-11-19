import { CardDef, contains, field } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class Sale extends CardDef {
  static displayName = 'Sale';
  @field title = contains(StringField);
  @field discountPercent = contains(NumberField);
  // "active" while the sale runs, "ended" once the sale is over.
  @field status = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Sale) {
      return this.title ?? 'Untitled sale';
    },
  });
}
