import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import {
  DefaultFormatContextName,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  Format,
  Field,
} from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: any;
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
    codeRef?: ResolvedCodeRef;
  };
}

export default class Preview extends Component<Signature> {
  @provide(DefaultFormatContextName)
  get defaultFormat() {
    return this.args.format ?? 'isolated';
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
