import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import TextAreaField from 'https://cardstack.com/base/text-area';

export class License extends CardDef {
  static displayName = 'License';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field content = contains(TextAreaField);
  @field title = contains(StringField, {
    computeVia: function (this: License) {
      return this.name;
    },
  });
}
