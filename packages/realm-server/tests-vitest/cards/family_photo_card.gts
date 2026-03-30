import {
  contains,
  linksToMany,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { PersonCard } from './person-with-error';

export class FamilyPhotoCard extends CardDef {
  static displayName = 'Family Photo Card';

  // URL of the photo
  @field photoUrl = contains(StringField, {
    description: 'URL of the photo',
  });
  @field thumbnailUrl = contains(StringField, {
    computeVia: function (this: FamilyPhotoCard) {
      return this.photoUrl;
    },
  });

  // Tags: People linked to this photo
  @field taggedPeople = linksToMany(PersonCard);
  @field widthInches = contains(NumberField);
  @field heightInches = contains(NumberField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <style>
        .photo {
          max-width: 100%;
          border: 2px solid #ccc;
          border-radius: 5px;
          display: block;
        }
      </style>
      <div>
        <div>
          Dimensions:
          {{@model.widthInches}}" by
          {{@model.heightInches}}"</div>
        <div>Tagged People:</div>
        <ul>
          {{#each @model.taggedPeople as |person|}}
            <li>{{person.name}}</li>
          {{/each}}
        </ul>
      </div>
      <img src={{@model.photoUrl}} alt='Photo' class='photo' />
    </template>
  };

  static embedded = this.isolated;
}
