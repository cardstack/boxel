import {
  contains,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { CountryField } from './country';

function getAddressRows(
  addressLine1: string | undefined,
  addressLine2: string | undefined,
  city: string | undefined,
  state: string | undefined,
  postalCode: string | undefined,
  countryCode: string | undefined,
  poBoxNumber: string | undefined,
) {
  const rows: string[][] = [[], [], []];

  if (addressLine1) {
    rows[0].push(addressLine1);
  }
  if (addressLine2) {
    rows[0].push(addressLine2);
  }

  const cityStatePostal = [city, state, postalCode].filter(Boolean).join(', ');

  if (cityStatePostal) {
    rows[1].push(cityStatePostal);
  }

  if (countryCode) {
    rows[2].push(countryCode);
  }

  if (poBoxNumber) {
    rows[3].push(`PO Box ${poBoxNumber}`);
  }
  return rows;
}

export class Address extends FieldDef {
  static displayName = 'Address';
  @field addressLine1 = contains(StringField);
  @field addressLine2 = contains(StringField);
  @field city = contains(StringField);
  @field state = contains(StringField);
  @field postalCode = contains(StringField);
  @field country = contains(CountryField);
  @field poBoxNumber = contains(StringField);
  @field fullAddress = contains(StringField, {
    computeVia: function (this: Address) {
      let rows = getAddressRows(
        this.addressLine1,
        this.addressLine2,
        this.city,
        this.state,
        this.postalCode,
        this.country?.code,
        this.poBoxNumber,
      );
      return rows.join(' ');
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get addressRows() {
      return getAddressRows(
        this.args.model.addressLine1,
        this.args.model.addressLine2,
        this.args.model.city,
        this.args.model.state,
        this.args.model.postalCode,
        this.args.model.country?.code,
        this.args.model.poBoxNumber,
      );
    }

    <template>
      <address>
        {{#each this.addressRows as |section|}}
          <div>
            {{#each section as |line|}}
              {{line}}
            {{/each}}
          </div>
        {{/each}}
      </address>
    </template>
  };
}
