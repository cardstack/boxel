import {
  contains,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Address extends FieldDef {
  static displayName = 'Address';
  @field streetAddress = contains(StringCard); // required
  @field city = contains(StringCard); // required
  @field region = contains(StringCard);
  @field postalCode = contains(StringCard);
  @field poBoxNumber = contains(StringCard);
  @field country = contains(StringCard); // required // dropdown

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
