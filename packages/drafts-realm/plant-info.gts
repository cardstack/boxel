import { Dropdown as DropdownField } from "./dropdown";
import { CardDef, field, containsMany, StringField, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class PlantInfo extends CardDef {
  @field commonName = containsMany(StringField);
  @field scientificName = contains(StringField);
  @field lightReq = contains(DropdownField);
  static displayName = "Plant Info";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

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