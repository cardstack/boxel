import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

// The starting data of the bulk-edit evaluation: thirty recipes the assistant
// changes in one pass.
export class Recipe extends CardDef {
  static displayName = 'Recipe';
  @field name = contains(StringField);
  @field cuisine = contains(StringField);
  @field minutes = contains(NumberField);
  @field weekendOnly = contains(BooleanField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Recipe) {
      return this.name;
    },
  });

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='recipe'>
        <strong><@fields.name /></strong>
        <span><@fields.cuisine /> · <@fields.minutes /> min</span>
      </div>
      <style scoped>
        .recipe {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
          padding: var(--boxel-sp-xs);
        }
      </style>
    </template>
  };
}
