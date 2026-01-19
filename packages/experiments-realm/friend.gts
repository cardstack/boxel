import {
  contains,
  linksTo,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { GridContainer } from '@cardstack/boxel-ui/components';
import UserPlus from '@cardstack/boxel-icons/user-plus';

export class Friend extends CardDef {
  static displayName = 'Friend';
  static icon = UserPlus;
  @field firstName = contains(StringField);
  @field friend = linksTo(() => Friend);
  @field test = contains(NumberField, {
    computeVia: function () {
      // make sure we don't blow up when '/' appears
      return 10 / 2;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Friend) {
      return this.firstName;
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Friend) {
      return `Friend`;
    },
  });
  @field cardThumbnailURL = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <@fields.firstName />
      </GridContainer>
    </template>
  };
}
