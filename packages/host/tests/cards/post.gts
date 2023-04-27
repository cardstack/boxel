import {
  contains,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import DatetimeCard from 'https://cardstack.com/base/datetime';
import IntegerCard from 'https://cardstack.com/base/integer';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';
import { Person } from './person';

export class Post extends Card {
  @field title = contains(StringCard);
  @field description = contains(StringCard);
  @field author = contains(Person);
  @field views = contains(IntegerCard);
  @field createdAt = contains(DatetimeCard);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: Post) {
      let metadata = new MetadataCard();
      metadata.title = this.title;
      return metadata;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title />
        by
        <@fields.author.firstName />
        (<@fields.author.fullName />)</h1>
    </template>
  };
}
