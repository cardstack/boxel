import { CardDef } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';
import MapIcon from '@cardstack/boxel-icons/map';

declare global {
  let L: any;
}

export class LeafletMap extends CardDef {
  static displayName = 'Leaflet Map';
  static icon = MapIcon;

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  @field tileserverUrl = contains(StringField);

  map: any;

  @action
  setMap(map: any) {
    this.map = map;
  }

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <figure
        {{LeafletModifier
          lat=@model.lat
          lon=@model.lon
          tileserverUrl=@model.tileserverUrl
          setMap=@model.setMap
        }}
        class='map'
      >
        Map loading for
        {{@model.lat}},
        {{@model.lon}}
      </figure>

      <style scoped>
        figure.map {
          margin: 0;
          width: 100%;
          height: 100%;
        }
      </style>
      <link
        href='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css'
        rel='stylesheet'
      />
    </template>
  };

  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }




  */
}

interface LeafletModifierSignature {
  Args: {
    Positional: [];
    Named: {
      lat: number | undefined;
      lon: number | undefined;
      tileserverUrl?: string;
      setMap?: (map: any) => void;
    };
  };
}

export class LeafletModifier extends Modifier<LeafletModifierSignature> {
  element: HTMLElement | null = null;

  modify(
    element: HTMLElement,
    [],
    { lat, lon, tileserverUrl, setMap }: NamedArgs<LeafletModifierSignature>,
  ) {
    fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js')
      .then((r) => r.text())
      .then((t) => {
        eval(t);
        let map = L.map(element).setView([lat, lon], 13);

        L.tileLayer(
          tileserverUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ).addTo(map);

        setMap?.(map);
      });
  }
}
