import {
  contains,
  linksTo,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Friend extends CardDef {
  @field firstName = contains(StringCard);
  @field friend = linksTo(() => Friend);
  @field title = contains(StringCard, {
    computeVia: function (this: Friend) {
      return this.firstName;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName />
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='friend'>
        <@fields.firstName />
        has a friend
        <@fields.friend />
      </div>
      <style scoped>
        .friend {
          color: red;
        }
      </style>
    </template>
  };
}
