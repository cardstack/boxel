import {
  CardDef,
  field,
  contains,
  StringField,
  linksTo,
} from 'https://cardstack.com/base/card-api';

import { Sphere } from './sphere';

export class Category extends CardDef {
  static displayName = 'Category';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field sphere = linksTo(() => Sphere);
  @field title = contains(StringField, {
    computeVia: function (this: Category) {
      return this.name;
    },
  });
}
