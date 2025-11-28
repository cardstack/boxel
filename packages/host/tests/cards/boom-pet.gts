import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';

export class Pet extends CardDef {
  static displayName = 'Pet';

  @field name = contains(StringField);
  @field hasError = contains(BooleanField);
  @field boom = contains(StringField, {
    computeVia: function (this: Pet) {
      if (this.hasError) {
        throw new Error('hasError was set to true');
      }
      return 'ok';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='pet-card'>
        <h2>{{@model.name}}</h2>
        <p>Boom: <@fields.boom /></p>
      </div>
      <style scoped>
        .pet-card {
          display: grid;
          gap: 0.25rem;
        }
      </style>
    </template>
  };
}
