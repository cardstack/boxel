import {
  contains,
  linksTo,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Friend extends Card {
  @field firstName = contains(StringCard);
  @field friend = linksTo(() => Friend);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName />
    </template>
  };
}
