import {
  contains,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: Person) {
      let metadata = new MetadataCard();
      metadata.title = this.firstName;
      return metadata;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-card><@fields.firstName /></h1>
    </template>
  };
}
