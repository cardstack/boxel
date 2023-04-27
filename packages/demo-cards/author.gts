import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';
import {
  Component,
  Card,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

export class Author extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: Author) {
      return {
        title: [this.firstName, this.lastName].filter(Boolean).join(' '),
      };
    },
  });
  // @field profilePicture = contains(StringCard); // TODO: image card
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName /> <@fields.lastName />
    </template>
  };
}
