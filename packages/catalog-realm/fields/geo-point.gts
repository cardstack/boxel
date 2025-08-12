import {
  Component,
  field,
  contains,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import MapIcon from '@cardstack/boxel-icons/map';

import { FieldContainer } from '@cardstack/boxel-ui/components';

class sharedTemplate extends Component<typeof GeoPointField> {
  get latValue() {
    return this.args.model?.lat ?? 'N/A';
  }

  get lonValue() {
    return this.args.model?.lon ?? 'N/A';
  }

  <template>
    <div class='geo-point-display'>
      <MapIcon class='map-icon' />
      <span class='coordinates'>{{this.latValue}}, {{this.lonValue}}</span>
    </div>

    <style scoped>
      .geo-point-display {
        display: inline-flex;
        align-items: center;
        gap: var(--geo-point-gap, var(--boxel-sp-xxs));
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--map-icon-color, var(--boxel-red));
        width: var(--map-icon-width, 16px);
        height: var(--map-icon-height, 16px);
      }
    </style>
  </template>
}

export class GeoPointField extends FieldDef {
  static displayName = 'Geo Point';

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  static edit = class Edit extends Component<typeof this> {
    <template>
      <FieldContainer @vertical={{true}} @label='Latitude' @tag='label'>
        <@fields.lat />
      </FieldContainer>
      <FieldContainer @vertical={{true}} @label='Longitude' @tag='label'>
        <@fields.lon />
      </FieldContainer>

      <style scoped>
        label + label {
          margin-top: var(--boxel-sp-xs);
        }
      </style>
    </template>
  };

  static atom = sharedTemplate;
  static embedded = sharedTemplate;
}
