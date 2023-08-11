import {
  contains,
  linksToMany,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Friend } from './friend';
import { GridContainer } from '@cardstack/boxel-ui';

export class Friends extends Card {
  static displayName = 'Friends';
  @field firstName = contains(StringCard);
  @field friends = linksToMany(Friend);
  @field title = contains(StringCard, {
    computeVia: function (this: Friends) {
      return this.firstName;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <@fields.firstName />
        has
        {{@model.friends.length}}
        friends
      </GridContainer>
    </template>
  };
}
