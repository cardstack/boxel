import Component from '@glimmer/component';

import { type CardError } from '../../resources/card-resource';

interface Signature {
  Args: {
    error: CardError['errors'][0];
  };
}
export default class CardErrorDetail extends Component<Signature> {
  <template>

  </template>
}
