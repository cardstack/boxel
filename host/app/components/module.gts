import Component from '@glimmer/component';
import { getCardRefsForModule } from '../resources/card-refs';
import Schema from './schema';

interface Signature {
  Args: {
    url: string;
  }
}

export default class Module extends Component<Signature> {
  <template>
    {{#each this.cardRefs.refs as |ref|}}
      <Schema @ref={{ref}} />
    {{/each}}
  </template>

  cardRefs = getCardRefsForModule(this, () => this.args.url);
}
