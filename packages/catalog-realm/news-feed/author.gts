import {
  CardDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';

export class Author extends CardDef {
  static displayName = 'Author';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Author) {
      return this.name;
    },
  });
}
