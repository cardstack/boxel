import Component from '@glimmer/component';

import type {
  BaseDef,
  CardContext,
  Format,
  Field,
} from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
    context?: CardContext;
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
      this.args.field,
      this.args.context,
    );
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Preview: typeof Preview;
  }
}
