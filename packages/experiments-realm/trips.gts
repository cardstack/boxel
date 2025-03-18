import {
  linksToMany,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { Country } from './country';

export class Trips extends FieldDef {
  static displayName = 'Trips';
  @field countriesVisited = linksToMany(Country);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.countriesVisited />
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='trips-fitted'>
        Trips: <@fields.countriesVisited class='countries' @format='atom' @displayContainer={{false}} />
      </div>
      <style>
        .trips-fitted {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}
