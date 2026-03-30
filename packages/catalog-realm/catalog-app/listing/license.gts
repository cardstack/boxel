import {
  CardDef,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import TextAreaField from '@cardstack/base/text-area';

export class License extends CardDef {
  static displayName = 'License';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field content = contains(TextAreaField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: License) {
      return this.name;
    },
  });
}
