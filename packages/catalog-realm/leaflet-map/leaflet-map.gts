import MapIcon from '@cardstack/boxel-icons/map';

import StringField from 'https://cardstack.com/base/string';
import {
  CardDef,
  contains,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';

import { GeoPointField } from '../fields/geo-point';
import { MapRender } from '../components/map-render';

export class LeafletMap extends CardDef {
  static displayName = 'Leaflet Map';
  static icon = MapIcon;

  @field geoPoint = contains(GeoPointField);
  @field tileserverUrl = contains(StringField);

  static isolated = class IsolatedTemplate extends Component<typeof this> {
    updateCoordinates = (lat: number, lon: number) => {
      if (this.args.model?.geoPoint) {
        this.args.model.geoPoint.lat = lat;
        this.args.model.geoPoint.lon = lon;
      }
    };

    <template>
      <MapRender
        @lat={{@model.geoPoint.lat}}
        @lon={{@model.geoPoint.lon}}
        @tileserverUrl={{@model.tileserverUrl}}
        @config={{@model.geoPoint.config}}
        @onMapClickUpdate={{this.updateCoordinates}}
      />
    </template>
  };
}
