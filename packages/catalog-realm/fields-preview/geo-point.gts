import { GeoPointField } from '../fields/geo-point';

import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';

export class GeoPointPreview extends CardDef {
  @field geoPoint = contains(GeoPointField);

  static displayName = 'Geo Point Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer @vertical={{true}} @label='Edit'>
          <@fields.geoPoint @format='edit' />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Atom'>
          <@fields.geoPoint @format='atom' />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Embedded'>
          <@fields.geoPoint @format='embedded' />
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
