import { UrlField } from "./url";
import { CardDef, field, contains, containsMany } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class ExperimentsFieldsPreview extends CardDef {
  @field url = contains(UrlField);
  @field links = containsMany(UrlField);
  static displayName = "Experiments Fields Preview";


  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <ul>
        <li>
          URL field:
          <ul>
            <li>
              Atom:
              <@fields.url target='_blank' @format='atom' />
            </li>
            <li>
              Embedded:
              <@fields.url @format='embedded' />
            </li>
            <li>
              Edit:
              <@fields.url @format='edit' />
            </li>
          </ul>
        </li>
        <li>
          URL (linksToMany):
          <ul>
            <li>
              Atom:
              <@fields.links @format='atom' />
            </li>
            <li>
              Embedded:
              <@fields.links @format='embedded' />
            </li>
            <li>
              Edit:
              <@fields.links @format='edit' />
            </li>
          </ul>
        </li>
      </ul>
    </template>
  }
  
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

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
}