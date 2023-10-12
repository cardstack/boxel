import {
  contains,
  linksTo,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';
import GridContainer from '@cardstack/boxel-ui/components/grid-container';

export class Friend extends CardDef {
  static displayName = 'Friend';
  @field firstName = contains(StringCard);
  @field friend = linksTo(() => Friend);
  @field test = contains(NumberCard, {
    computeVia: function () {
      // make sure we don't blow up when '/' appears
      return 10 / 2;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Friend) {
      return this.firstName;
    },
  });
  @field description = contains(StringCard, {
    computeVia: function (this: Friend) {
      return `Friend`;
    },
  });
  @field thumbnailURL = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <@fields.firstName />
      </GridContainer>
    </template>
  };
}
