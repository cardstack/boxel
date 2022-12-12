import Component from '@glimmer/component';
import { service } from '@ember/service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: Card
    format: Format;
  }
}

export default class ServerRender extends Component<Signature> {
  <template>
    <!--Server Side Rendered Card START-->
    <this.renderedCard/>
    <!--Server Side Rendered Card END-->
  </template>

  @service declare fastboot: { isFastBoot: boolean };
  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card, this.args.format, this.fastboot.isFastBoot);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    ServerRender: typeof ServerRender;
   }
}
