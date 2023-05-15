import Component from '@glimmer/component';
import type {
  CardBase,
  CardRenderingContext,
  Format,
} from 'https://cardstack.com/base/card-api';
import { type Actions } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    card: CardBase;
    format?: Format;
    actions?: Actions;
    context?: CardRenderingContext;
  };
}

export default class Preview extends Component<Signature> {
  <template>
    <this.renderedCard />
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.format ?? 'isolated',
      this.args.actions,
      this.args.context
    );
  }
}
