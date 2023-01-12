import Component from '@glimmer/component';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import type { ComponentOptions } from 'https://cardstack.com/base/field-component';

interface Signature {
  Args: {
    card: Card;
    format: Format;
    opts?: ComponentOptions
  }
}

export default class Render extends Component<Signature> {
  <template>
    <!--Server Side Rendered Card HTML START-->
    <this.renderedCard/>
    <!--Server Side Rendered Card HTML END-->
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card, this.args.format, this.args.opts);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Render: typeof Render;
   }
}
