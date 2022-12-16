import Component from '@glimmer/component';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: Card
    format: Format;
  }
}

export default class Render extends Component<Signature> {
  <template>
    <!--Server Side Rendered Card START-->
    <this.renderedCard/>
    <!--Server Side Rendered Card END-->
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card, this.args.format);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Render: typeof Render;
   }
}
