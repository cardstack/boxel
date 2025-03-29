import { service } from '@ember/service';

import Component from '@glimmer/component';

import { provide, consume } from 'ember-provide-consume-context';

import {
  CardContextName,
  DefaultFormatsContextName,
  CardURLContextName,
  GetCardContextName,
  GetCardsContextName,
  ResolvedCodeRef,
  type getCard,
  type getCards,
} from '@cardstack/runtime-common';

import type StoreService from '@cardstack/host/services/store';

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
    displayContainer?: boolean;
  };
}

export default class Preview extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @service private declare store: StoreService;

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormat is declared but not used"
  get defaultFormat() {
    let { format } = this.args;
    format = format ?? 'isolated';
    return { cardDef: format, fieldDef: format };
  }

  @provide(CardContextName)
  // @ts-ignore "context is declared but not used"
  private get context() {
    return {
      prerenderedCardSearchComponent: PrerenderedCardSearch,
      getCard: this.getCard,
      getCards: this.getCards,
      store: this.store,
      ...this.args.cardContext,
    };
  }

  @provide(CardURLContextName)
  // @ts-ignore "cardURL is declared but not used"
  private get cardURL() {
    return 'id' in this.args.card
      ? (this.args.card?.id as string | undefined)
      : undefined;
  }

  <template>
    <this.renderedCard @displayContainer={{@displayContainer}} ...attributes />
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.field,
      this.args.codeRef ? { componentCodeRef: this.args.codeRef } : undefined,
    );
  }
}
