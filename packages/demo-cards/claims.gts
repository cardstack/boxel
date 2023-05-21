import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import {
  Card,
  Component,
  contains,
  field,
  linksToMany,
  StringCard,
} from 'https://cardstack.com/base/card-api';
import { Claim } from './claim';

// perhaps cards-grid??
export class Claims extends Card {
  static displayName = 'Claims';
  @field claims = linksToMany(Claim);
  @field title = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer
          @label='Number of claims.'
        >{{@model.claims.length}}</FieldContainer>
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer
          @label='Number of claims'
        >{{@model.claims.length}}</FieldContainer>
        <@fields.claims />

      </CardContainer>
    </template>
  };
}
