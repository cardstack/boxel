import {
  contains,
  linksTo,
  linksToMany,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class FriendWithUsedLink extends CardDef {
  @field firstName = contains(StringField);
  @field friend = linksTo(() => FriendWithUsedLink, { isUsed: true }); // using isUsed: true will throw when ensureLinksLoaded encounters broken links
  @field friends = linksToMany(() => FriendWithUsedLink);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: FriendWithUsedLink) {
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
