import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import {
  CardContextName,
  DefaultFormatContextName,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  Format,
  Field,
} from 'https://cardstack.com/base/card-api';
import PrerenderedCardSearch from './prerendered-card-search';

interface Signature {
  Element: any;
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

  @provide(CardContextName)
  private get context() {
    return {
      prerenderedCardSearchComponent: PrerenderedCardSearch,
    };
  }

  <template>
    <this.renderedCard ...attributes />
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.field,
    );
  }
}
