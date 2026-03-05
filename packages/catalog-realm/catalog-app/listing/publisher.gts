import { CardDef, field, contains } from '@cardstack/base/card-api';
import { StringField } from '@cardstack/base/card-api';

export class Publisher extends CardDef {
  static displayName = 'Publisher';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia(this: Publisher) {
      return this.name;
    },
  });
}
