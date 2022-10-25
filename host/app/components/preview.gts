import Component from '@glimmer/component';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: Card;
    format?: Format;
  }
}

export default class Preview extends Component<Signature> {
  <template>
    <this.renderedCard />
  </template>

  get renderedCard() {
    return this.args.card.constructor.api.getComponent(this.args.card, this.args.format ?? 'isolated');
  }
}
