import {
  contains,
  linksTo,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import IntegerCard from 'https://cardstack.com/base/integer';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';

export class Friend extends Card {
  @field firstName = contains(StringCard);
  @field friend = linksTo(() => Friend);
  @field test = contains(IntegerCard, {
    computeVia: function () {
      // make sure we don't blow up when '/' appears
      return 10 / 2;
    },
  });
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: Friend) {
      let metadata = new MetadataCard();
      metadata.title = this.firstName;
      return metadata;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName />
    </template>
  };
}
