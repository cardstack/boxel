import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import {
  CardContextName,
  DefaultFormatContextName,
  ResolvedCodeRef,
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
    codeRef?: ResolvedCodeRef;
    cardContext?: Record<string, any>;
  };
}

export default class Preview extends Component<Signature> {
  @provide(DefaultFormatContextName)
  // @ts-ignore
  get defaultFormat() {
    return this.args.format ?? 'isolated';
  }

  @provide(CardContextName)
  // @ts-ignore
  private get context() {
    return {
      prerenderedCardSearchComponent: PrerenderedCardSearch,
      ...this.args.cardContext,
    };
  }

  <template>
    <this.renderedCard ...attributes />
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.field,
      this.args.codeRef ? { componentCodeRef: this.args.codeRef } : undefined,
    );
  }
}
