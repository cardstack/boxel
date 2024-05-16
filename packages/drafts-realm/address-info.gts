import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { FieldContainer, CardContainer } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import emberPlaceAutocomplete from 'https://cdn.jsdelivr.net/npm/ember-place-autocomplete@2.1.2/+esm';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

class View extends Component<typeof AddressInfo> {
  get placeUrl() {
    return this.args.model.mapUrl;
  }

  <template>
    <@fields.address />
    <@fields.city />
    <@fields.state />
    <@fields.zip />
    <@fields.country />
    <div class='gmap_canvas'>
      <div class='overlay'></div>
      <iframe
        id='gmap_canvas'
        width={{600}}
        height={{400}}
        referrerpolicy='no-referrer-when-downgrade'
        src={{this.placeUrl}}
        frameborder='0'
        scrolling='no'
        marginheight='0'
        marginwidth='0'
        style='pointer-events: none;'
      ></iframe></div>

    <style>
      .gmap_canvas {
        position: relative;
      }
      .overlay {
        background: transparent;
        position: absolute;
        width: 100%;
        height: 100%;
        top: 0;
        margin-top: 0;
      }
    </style>
  </template>
}

class Edit extends Component<typeof AddressInfo> {
  @action handleInputChange(event: any) {
    const inputValue = event.target.value;
  }

  <template>
    <CardContainer @displayBoundaries={{true}} class='card-container'>
      <FieldContainer
        @tag='label'
        @label='Address'
        @vertical={{true}}
        {{on 'input' this.handleInputChange}}
      ><@fields.address /></FieldContainer>
      <FieldContainer
        @tag='label'
        @label='City'
        @vertical={{true}}
      ><@fields.city /></FieldContainer>
      <FieldContainer
        @tag='label'
        @label='State'
        @vertical={{true}}
      ><@fields.state /></FieldContainer>
      <FieldContainer
        @tag='label'
        @label='Zip/ Postal Code'
        @vertical={{true}}
      ><@fields.zip /></FieldContainer>
      <FieldContainer
        @tag='label'
        @label='Country'
        @vertical={{true}}
      ><@fields.country /></FieldContainer>
    </CardContainer>

    <style>
      .card-container {
        padding: 2rem 1rem;
        display: grid;
        gap: var(--boxel-sp-sm);
        grid-template-columns: 1fr;
        background-color: #eeeeee50;
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }

      @media (min-width: 768px) {
        .card-container {
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        }
      }
    </style>
  </template>
}

export class AddressInfo extends FieldDef {
  static displayName = 'Mailing Address';
  @field address = contains(StringField, {
    description: `Mailing Address`,
  });
  @field zip = contains(StringField, {
    description: `Mailing Zip/Postal Code`,
  });
  @field city = contains(StringField, {
    description: `Mailing City`,
  });
  @field state = contains(StringField, {
    description: `Mailing State/Province`,
  });
  @field country = contains(StringField, {
    description: `Mailing Country`,
  });

  @field mapUrl = contains(StringField, {
    computeVia: function (this: AddressInfo) {
      return `https://maps.google.com/maps?q=${this.address}&t=&z=13&ie=UTF8&iwloc=&output=embed`;
    },
  });

  // static atom = View;
  static embedded = View;
  static edit = Edit;
}
