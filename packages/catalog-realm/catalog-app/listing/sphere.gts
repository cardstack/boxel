import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';

export class Sphere extends CardDef {
  static displayName = 'Sphere';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Sphere) {
      return this.name;
    },
  });
}
