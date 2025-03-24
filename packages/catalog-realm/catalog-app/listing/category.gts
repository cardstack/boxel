import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';

export class Category extends CardDef {
  static displayName = 'Category';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Category) {
      return this.name;
    },
  });
}

export class Tag extends CardDef {
  static displayName = 'Tag';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Tag) {
      return this.name;
    },
  });
}
