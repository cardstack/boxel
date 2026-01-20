import {
  contains,
  linksTo,
  field,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Friend extends CardDef {
  @field firstName = contains(StringField);
  @field friend = linksTo(() => Friend);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Friend) {
      return this.firstName;
    },
  });
  @field cardDescription = contains(StringField);
  @field cardThumbnailURL = contains(StringField);
}
