import {
  contains,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';

export class UnusedCard extends Card {
  @field firstName = contains(StringCard);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: UnusedCard) {
      let metadata = new MetadataCard();
      metadata.title = this.firstName;
      return metadata;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
    </template>
  };
}
