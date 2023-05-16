import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import {
  Card,
  Component,
  contains,
  field,
  linksToMany,
  StringCard,
} from 'https://cardstack.com/base/card-api';
import IntegerCard from 'https://cardstack.com/base/integer';
import { Claim } from './claim';

// perhaps cards-grid??
export class Claims extends Card {
  static displayName = 'Claims';
  @field claims = linksToMany(() => Claim);
  @field count = contains(IntegerCard, {
    computeVia(this: Claims) {
      return this.claims.length;
    },
  });
  @field title = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer @label='Number of claims.'><@fields.count
          /></FieldContainer>
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer @label='Number of claims.'><@fields.count
          /></FieldContainer>
        <@fields.claims />

      </CardContainer>
    </template>
  };
}
