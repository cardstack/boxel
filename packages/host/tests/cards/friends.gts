import {
  contains,
  linksToMany,
  field,
  Card,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';

export class Friends extends Card {
  @field firstName = contains(StringCard);
  @field friends = linksToMany(() => Friends);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: Friends) {
      let metadata = new MetadataCard();
      metadata.title = this.firstName;
      return metadata;
    },
  });
}
