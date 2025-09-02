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
    updateCoordinate = (coordinate: { lat: number; lng: number }) => {
      if (this.args.model?.geoPoint) {
        this.args.model.geoPoint.lat = coordinate.lat;
        this.args.model.geoPoint.lon = coordinate.lng;
      }
    };

    get coordinate() {
      const lat = this.args.model.geoPoint?.lat ?? 0;
      const lon = this.args.model.geoPoint?.lon ?? 0;
      return [{ lat, lng: lon }];
    }

    <template>
      <MapRender
        @coordinates={{this.coordinate}}
        @onMapClick={{this.updateCoordinate}}
      />
    </template>
  };
}
