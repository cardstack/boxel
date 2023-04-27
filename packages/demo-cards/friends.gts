import {
  contains,
  linksToMany,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer } from '@cardstack/boxel-ui';

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
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        Name:
        <@fields.firstName />
      </CardContainer>
    </template>
  };
}
