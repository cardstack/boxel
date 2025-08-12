import { Component } from 'https://cardstack.com/base/card-api';
import { LeafletMap } from '../leaflet-map';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';

export class MapRender extends Component<typeof LeafletMap> {
  map: any;

  @action
  setMap(map: any) {
    this.map = map;
  }

  <template>
    <figure
      {{LeafletModifier
        lat=@model.geoPoint.lat
        lon=@model.geoPoint.lon
        tileserverUrl=@model.tileserverUrl
        setMap=this.setMap
      }}
      class='map'
    >
      Map loading for
      {{@model.geoPoint.lat}},
      {{@model.geoPoint.lon}}
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
