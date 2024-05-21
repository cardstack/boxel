import {
  contains,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';
import StringField from 'https://cardstack.com/base/string';

export class Country extends CardDef {
  static displayName = 'Country';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia(this: Country) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <address>
        <@fields.name />
      </address>
    </template>
  };
}
