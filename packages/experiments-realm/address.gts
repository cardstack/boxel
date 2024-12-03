import {
  contains,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { BoxelSelect } from '@cardstack/boxel-ui/components/';
import StringField from 'https://cardstack.com/base/string';
import { CountryField } from './country';

export class Address extends FieldDef {
  static displayName = 'Address';
  @field addressLine1 = contains(StringField);
  @field addressLine2 = contains(StringField);
  @field city = contains(StringField);
  @field state = contains(StringField);
  @field postalCode = contains(StringField);
  @field country = contains(CountryField);
  @field poBoxNumber = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    get addressRows() {
      const rows: string[][] = [[], [], []];

      if (this.args.model.poBoxNumber) {
        rows[0].push(`PO Box ${this.args.model.poBoxNumber}`);
      } else {
        rows[0].push(this.args.model.addressLine1);
        if (this.args.model.addressLine2) {
          rows[0].push(this.args.model.addressLine2);
        }
      }

      const cityStatePostal = [
        this.args.model.city,
        this.args.model.state,
        this.args.model.postalCode,
      ]
        .filter(Boolean)
        .join(', ');

      if (cityStatePostal) {
        rows[1].push(cityStatePostal);
      }

      if (this.args.model.country.code) {
        rows[2].push(this.args.model.country.code);
      }

      return rows;
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
