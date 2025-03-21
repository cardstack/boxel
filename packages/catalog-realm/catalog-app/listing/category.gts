import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';

export class Category extends CardDef {
  static displayName = 'Category';
  @field name = contains(StringField);
}

export class Tag extends CardDef {
  static displayName = 'Tag';
  @field name = contains(StringField);
}
