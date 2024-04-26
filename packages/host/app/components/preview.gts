import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import { DefaultFormatContextName } from '@cardstack/runtime-common';

import type {
  BaseDef,
  Format,
  Field,
} from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
  };
}

export default class Preview extends Component<Signature> {
  @provide(DefaultFormatContextName)
  get defaultFormat() {
    return this.args.format ?? 'isolated';
  }

  <template>
    <this.renderedCard />
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.field,
    );
  }
}
