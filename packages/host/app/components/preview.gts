import Component from '@glimmer/component';
import type { Primitive, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: Primitive;
    format?: Format;
  };
}

export default class Preview extends Component<Signature> {
  <template>
    <this.renderedCard />
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.format ?? 'isolated'
    );
  }
}
