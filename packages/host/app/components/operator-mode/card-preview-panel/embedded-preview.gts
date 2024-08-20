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
    <div class='wrapper'>
      <this.renderedCard @displayContainer={{true}} class='card' />
    </div>

    <style>
      .wrapper {
        margin: 20px;
      }
    </style>
  </template>
}
