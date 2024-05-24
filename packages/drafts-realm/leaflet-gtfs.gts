import { CardDef } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import Modifier from 'ember-modifier';
import jszip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

type Route = {
  id: string;
  number: string;
};

export class LeafletGtfs extends CardDef {
  static displayName = 'Leaflet GTFS';

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  @field tileserverUrl = contains(StringField);

  map;

  @tracked routes: Route[] = [];
  @tracked activeRouteId: string | null = null;

  @tracked shapes = [];

  @tracked trips = [];

  @tracked routesFeatureGroup = null;
  @tracked routePolylines = [];

  @action
  setMap(map) {
    this.map = map;
  }

  @action
  setRoutes(routes) {
    this.routes = routes.map((routeCsv) => ({
      id: routeCsv.route_id,
      name: `${routeCsv.route_short_name} ${routeCsv.route_long_name}`,
    }));
  }

  @action
  setShapes(shapes) {
    this.shapes = shapes;
  }

  @action
  setTrips(trips) {
    this.trips = trips;
  }

  @action
  handleRouteSelect(e: Event) {
    if (e.target) {
      let select = e.target as HTMLSelectElement;
      this.setActiveRouteId(select.value);
    }
  }

  @action
  setActiveRouteId(activeRouteId: string) {
    this.activeRouteId = activeRouteId;

    this.routesFeatureGroup?.remove();

    let activeRouteVariantPoints = this.activeRouteVariantPoints;

    if (activeRouteVariantPoints) {
      this.routesFeatureGroup = L.featureGroup(
        activeRouteVariantPoints.map((points) => {
          return L.polyline(points);
        }),
      );

      this.routesFeatureGroup.addTo(this.map);
      this.map.fitBounds(this.routesFeatureGroup.getBounds());
    } else {
      this.routesFeatureGroup = null;
    }
  }

  get activeRouteShapeIds() {
    if (this.trips) {
      return this.trips.reduce((shapeIds, trip) => {
        if (trip.route_id === this.activeRouteId) {
          shapeIds.add(trip.shape_id);
        }
        return shapeIds;
      }, new Set());
    }
  }

  get activeRouteVariantPoints() {
    if (this.shapes && this.activeRouteShapeIds) {
      let activeRouteShapeIds = this.activeRouteShapeIds;

      let shapeIdToPoints = new Map<string, [number, number][]>();

      this.shapes.forEach((shape) => {
        if (activeRouteShapeIds.has(shape.shape_id)) {
          if (!shapeIdToPoints.has(shape.shape_id)) {
            shapeIdToPoints.set(shape.shape_id, []);
          }

          shapeIdToPoints
            .get(shape.shape_id)
            .push([shape.shape_pt_lat, shape.shape_pt_lon]);
        }
      });

      return Array.from(shapeIdToPoints.values());
    }
  }

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <figure
        {{LeafletModifier
          lat=@model.lat
          lon=@model.lon
          tileserverUrl=@model.tileserverUrl
          setMap=@model.setMap
          setRoutes=@model.setRoutes
          setShapes=@model.setShapes
          setTrips=@model.setTrips
        }}
        class='map'
      >
        Map loading for
        {{@model.lat}},
        {{@model.lon}}
      </figure>

      <ul class='routes'>
        {{#if @model.routes}}
          Route to view:
          <select
            value={{@model.activeRouteId}}
            {{on 'change' @model.handleRouteSelect}}
          >
            <option value=''>Select a route</option>
            {{#each @model.routes as |route|}}
              <option value={{route.id}}>{{route.name}}</option>
            {{/each}}
          </select>
        {{/if}}
      </ul>

      <style>
        figure.map {
          margin: 0;
          width: 100%;
          height: 90%;
        }

        .routes {
          height: 10%;
        }

        button.active {
          font-weight: bold;
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
      tileserverUrl?: string;
      setMap: (any) => {};
      setRoutes: (any) => {};
      setShapes: (any) => {};
      setTrips: (any) => {};
    };
  };
}

class LeafletModifier extends Modifier<LeafletModifierSignature> {
  HTMLElement: element = null;

  modify(
    element,
    [],
    { lat, lon, tileserverUrl, setMap, setRoutes, setShapes, setTrips },
  ) {
    let map;

    fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js')
      .then((r) => r.text())
      .then((t) => {
        eval(t);
        map = L.map(element).setView([lat, lon], 13);
        setMap(map);

        L.tileLayer(
          tileserverUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ).addTo(map);

        return fetch(
          'https://s3.gtfs.pro/files/sourcedata/winnipegtransit.zip',
        );
      })
      .then((gtfsResponse) => {
        return gtfsResponse.blob();
      })
      .then(jszip.loadAsync)
      .then((zip) =>
        Promise.all(
          ['routes.txt', 'shapes.txt', 'trips.txt'].map((filename) =>
            zip.file(filename).async('string'),
          ),
        ),
      )
      .then(([routesCsv, shapesCsv, tripsCsv]) => {
        setRoutes(Papa.parse(routesCsv, { header: true }).data);
        setShapes(Papa.parse(shapesCsv, { header: true }).data);
        setTrips(Papa.parse(tripsCsv, { header: true }).data);
      });
  }
}
