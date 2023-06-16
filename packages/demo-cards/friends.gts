import {
  contains,
  linksToMany,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Friends extends Card {
  static displayName = 'Friends';
  @field firstName = contains(StringCard);
  @field friends = linksToMany(() => Friends);
  @field title = contains(StringCard, {
    computeVia: function (this: Friends) {
      return this.firstName;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='demo-card'>
        Name:
        <@fields.firstName />
      </div>
    </template>
  };
}
