import {
  contains,
  linksToMany,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer } from '@cardstack/boxel-ui';

export class Friends extends Card {
  static typeDisplayName = 'Friends';
  @field firstName = contains(StringCard);
  @field friends = linksToMany(() => Friends);
  @field title = contains(StringCard, {
    computeVia: function (this: Friends) {
      return this.firstName;
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
