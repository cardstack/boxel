import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class Recipe extends CardDef {
  static displayName = 'Recipe';
  @field dish = contains(StringField);
  @field cuisine = contains(StringField);
  @field servings = contains(NumberField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Recipe) {
      return this.dish ?? 'Untitled Recipe';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <p><strong><@fields.dish /></strong> — <@fields.cuisine /></p>
    </template>
  };
}
