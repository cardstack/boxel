import {
  linksToMany,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';
import FieldDef from 'https://cardstack.com/base/field-def';
import { Country } from './country';

export class Trips extends FieldDef {
  static displayName = 'Trips';
  @field countriesVisited = linksToMany(Country);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <address>
        <@fields.countriesVisited />
      </address>
    </template>
  };
}
