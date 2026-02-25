import BooleanField from '@cardstack/base/boolean';
import {
  CardDef,
  Component,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Pet extends CardDef {
  static displayName = 'Pet';

  @field name = contains(StringField);
  @field hasError = contains(BooleanField);
  @field boom = contains(StringField, {
    computeVia: function (this: Pet) {
      if (this.hasError) {
        throw new Error(
          'hasError was set to true because we deliberately want to get this card to a broken state',
        );
      }
      return 'hasError is false which means this card is not broken';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='pet-card'>
        <h2>{{@model.name}}</h2>
        <p><@fields.boom /></p>
      </div>
    </template>
  };
}
