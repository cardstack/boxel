import {
  contains,
  containsMany,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import DateTimeField from 'https://cardstack.com/base/datetime';
import StringField from 'https://cardstack.com/base/string';

import { PersonField } from './person';
import { PostField } from './post';

export class Booking extends CardDef {
  @field cardTitle = contains(StringField);
  @field venue = contains(StringField);
  @field startTime = contains(DateTimeField);
  @field endTime = contains(DateTimeField);
  @field hosts = containsMany(PersonField);
  @field sponsors = containsMany(StringField);
  @field posts = containsMany(PostField);
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Booking) {
      return this.venue;
    },
  });
  @field cardThumbnailURL = contains(StringField, { computeVia: () => null });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h2><@fields.cardTitle /></h2>
      <div><@fields.startTime /> to <@fields.endTime /></div>
      <div>Hosted by: <@fields.hosts /></div>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <h2><@fields.cardTitle /></h2>
      <div><@fields.startTime /> to <@fields.endTime /></div>
      <div>Hosted by: <@fields.hosts /></div>
    </template>
  };
}
