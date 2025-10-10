import { GeoSearchPointField } from '../fields/geo-search-point';

import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';

export class GeoSearchPointPreview extends CardDef {
  @field geoSearchPoint = contains(GeoSearchPointField);

  static displayName = 'Geo Search Point Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer @vertical={{true}} @label='Edit'>
          <@fields.geoSearchPoint @format='edit' />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Atom'>
          <@fields.geoSearchPoint @format='atom' />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Embedded'>
          <@fields.geoSearchPoint @format='embedded' />
        </FieldContainer>
      </section>

      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
}
