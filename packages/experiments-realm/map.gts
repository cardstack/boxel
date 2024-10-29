import NumberField from 'https://cardstack.com/base/number';
import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import MapIcon from '@cardstack/boxel-icons/map';

function or(value: number | undefined, defaultValue: number) {
  return value || defaultValue;
}

export class Map extends CardDef {
  static displayName = 'Map';
  static icon = MapIcon;

  @field address = contains(StringField);

  @field mapUrl = contains(StringField, {
    computeVia: function (this: Map) {
      return `https://maps.google.com/maps?q=${this.address}&t=&z=13&ie=UTF8&iwloc=&output=embed`;
    },
  });
  @field mapWidth = contains(NumberField);
  @field mapHeight = contains(NumberField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='gmap_canvas'><iframe
          id='gmap_canvas'
          title='Google Map'
          width={{or @model.mapWidth 600}}
          height={{or @model.mapHeight 400}}
          src={{@model.mapUrl}}
          frameborder='0'
          scrolling='no'
          marginheight='0'
          marginwidth='0'
        ></iframe></div>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <a
        href='https://www.google.com/maps/place/{{@model.address}}'
        target='_blank'
        rel='noopener noreferrer'
      >📍 {{@model.address}}</a>
    </template>
  };

  static embedded = this.isolated;
}
