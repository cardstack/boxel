import StringField from 'https://cardstack.com/base/string';
import { CardDef, contains, field } from 'https://cardstack.com/base/card-api';
import { GeoPointField } from '../fields/geo-point';
import { MapRender } from './components/map-render';
import MapIcon from '@cardstack/boxel-icons/map';

declare global {
  var L: any;
}

export class LeafletMap extends CardDef {
  static displayName = 'Leaflet Map';
  static icon = MapIcon;

  @field geoPoint = contains(GeoPointField);
  @field tileserverUrl = contains(StringField);

  static isolated = MapRender;
}
