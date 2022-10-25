import Component from '@glimmer/component';
import { service } from '@ember/service';
import CardService from '../services/card-service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

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

  @service declare cardService: CardService;
  get renderedCard() {
    if (this.cardService.components.has(this.args.card)) {
      return this.cardService.components.get(this.args.card)!(this.args.format ?? 'isolated');
    }
    return;
  }
}
