import {
  contains,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Address extends FieldDef {
  static displayName = 'Address';
  @field streetAddress = contains(StringField); // required
  @field city = contains(StringField); // required
  @field region = contains(StringField);
  @field postalCode = contains(StringField);
  @field poBoxNumber = contains(StringField);
  @field country = contains(StringField); // required // dropdown

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <address>
        <div><@fields.streetAddress /></div>
        <@fields.city />
        <@fields.region />
        <@fields.postalCode /><@fields.poBoxNumber />
        <@fields.country />
      </address>
    </template>
  };
}
