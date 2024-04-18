import {
  contains,
  linksToMany,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Friend } from './friend';
import { GridContainer } from '@cardstack/boxel-ui/components';

export class Friends extends CardDef {
  static displayName = 'Friends';
  @field firstName = contains(StringField);
  @field friends = linksToMany(Friend);
  @field title = contains(StringField, {
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
