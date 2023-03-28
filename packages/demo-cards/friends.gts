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
  @field firstName = contains(StringCard);
  @field friends = linksToMany(() => Friends);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        Name:
        <@fields.firstName />
      </CardContainer>
    </template>
  };
}
