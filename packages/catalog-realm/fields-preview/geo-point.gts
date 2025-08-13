import { GeoPointField } from '../fields/geo-point';

import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';

export class GeoPointPreview extends CardDef {
  @field geoPoint = contains(GeoPointField);

  static displayName = 'Geo Point Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Geo Point'
          @icon={{this.getFieldIcon 'geoPoint'}}
        >
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.geoPoint @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.geoPoint @format='embedded' />
          </FieldContainer>
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

    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };

    updateCoordinates = (lat: number, lon: number) => {
      if (this.args.model?.geoPoint) {
        this.args.model.geoPoint.lat = lat;
        this.args.model.geoPoint.lon = lon;
      }
    };
  };
}
