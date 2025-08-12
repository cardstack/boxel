import {
  Component,
  field,
  contains,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';

import { FieldContainer } from '@cardstack/boxel-ui/components';

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

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span>{{@model.lat}}, {{@model.lon}}</span>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span>{{@model.lat}}, {{@model.lon}}</span>
    </template>
  };
}
