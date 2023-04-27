import StringCard from 'https://cardstack.com/base/string';
import {
  Component,
  Card,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

export class Author extends Card {
  static typeDisplayName = 'Author';
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
  // @field profilePicture = contains(StringCard); // TODO: image card
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName /> <@fields.lastName />
    </template>
  };
}
