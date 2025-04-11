import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { StringField } from 'https://cardstack.com/base/card-api';

export class Publisher extends CardDef {
  static displayName = 'Publisher';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia(this: Publisher) {
      return this.name;
    },
  });
}
