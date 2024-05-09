import { CardDef } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import Modifier from 'ember-modifier';

export class LeafletMap extends CardDef {
  static displayName = 'Leaflet Map';

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <figure {{LeafletModifier lat=@model.lat lon=@model.lon}} class='map'>
        Map loading for
        {{@model.lat}},
        {{@model.lon}}
      </figure>

      <style>
        figure.map {
          margin: 0;
          width: 100%;
          height: 20rem;
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
      lat: number;
      lon: number;
    };
  };
}

class LeafletModifier extends Modifier<LeafletModifierSignature> {
  HTMLElement: element = null;

  modify(element, [], { lat, lon }) {
    fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js')
      .then((r) => r.text())
      .then((t) => {
        eval(t);
        var map = L.map(element).setView([lat, lon], 13);

        L.tileLayer(
          'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png',
        ).addTo(map);
      });
  }
}
