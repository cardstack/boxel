import { Component, Card } from 'https://cardstack.com/base/card-api';
import { CardContainer } from '@cardstack/boxel-ui';

export class CardsGrid extends Card {
  static displayName = 'Cards Grid';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        This cards-grid instance should become even better.
      </CardContainer>
    </template>
  };
}
