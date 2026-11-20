import { CardDef, contains, field } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class Recipe extends CardDef {
  static displayName = 'Recipe';
  @field name = contains(StringField);
  @field cuisine = contains(StringField);
  @field prepMinutes = contains(NumberField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Recipe) {
      return this.name ?? 'Untitled recipe';
    },
  });
}
