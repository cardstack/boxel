import Component from '@glimmer/component';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import { render } from '../resources/render-card';

interface Signature {
  Args: {
    card: Card;
    format?: Format;
  }
}

export default class Preview extends Component<Signature> {
  <template>
    {{#if this.renderedCard}}
      <this.renderedCard />
    {{/if}}
  </template>

  rendered = render(this, () => this.args.card, () => this.args.format ?? 'isolated');

  get renderedCard() {
    return this.rendered?.component;
  }
}
