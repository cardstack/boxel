import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { provide } from 'ember-provide-consume-context';

import { DefaultFormatsContextName } from '@cardstack/runtime-common';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: BaseDef;
  };
}
export default class EmbeddedPreview extends Component<Signature> {
  @provide(DefaultFormatsContextName)
  get defaultFormat() {
    return { cardDef: 'embedded', fieldDef: 'embedded' };
  }

  @cached
  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card);
  }

  <template>
    <div class='card'>
      <this.renderedCard @displayContainer={{false}} />
    </div>

    <style>
      .card {
        /* this is how a border would appear around a card.
           note that a card is not supposed to draw its own border
         */
        box-shadow: 0 0 0 1px var(--boxel-light-500);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        margin: 20px;
        container-name: embedded-card;
        container-type: inline-size;
      }
    </style>
  </template>
}
