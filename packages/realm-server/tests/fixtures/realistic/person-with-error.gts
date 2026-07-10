import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';

export class PersonCard extends CardDef {
  static displayName = 'Person';

  // Name of the person
  @field name = contains(StringField, {
    description: 'Name of the person',
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PersonCard) {
      return this.name;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <style>
        .person {
          font-weight: bold;
        }
      </style>
      <div>
        <span class='person'>{{@model.name}}</span>
      </div>
    </template>
  };

  static embedded = this.isolated;
}
