import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import World from '@cardstack/boxel-icons/world';

export class Country extends CardDef {
  static displayName = 'Country';
  static icon = World;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia(this: Country) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}
