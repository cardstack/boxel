import Component from '@glimmer/component';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import type { ComponentOptions } from 'https://cardstack.com/base/field-component';

interface Signature {
  Args: {
    searchDoc: Record<string, any>;
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

    <pre>
      <!--Server Side Rendered Card SearchDoc START-->
      {{this.searchDoc}}
      <!--Server Side Rendered Card SearchDoc END-->
    </pre>
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card, this.args.format, this.args.opts);
  }

  get searchDoc() {
    return JSON.stringify(this.args.searchDoc, null, 2);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Render: typeof Render;
   }
}
