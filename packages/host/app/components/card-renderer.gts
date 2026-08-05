import { service } from '@ember/service';
import Component from '@glimmer/component';

import { provide, consume } from 'ember-provide-consume-context';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import {
  CardContextName,
  CardCrudFunctionsContextName,
  DefaultFormatsContextName,
  CardURLContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  type getCard,
  type getCards,
  type getCardCollection,
} from '@cardstack/runtime-common';

import BoxelExecutionRenderer from '@cardstack/host/components/boxel-execution-renderer';
import HeadFormatPreview from '@cardstack/host/components/head-format-preview';
import type DirectBoxelRuntimeService from '@cardstack/host/services/direct-boxel-runtime';

import type {
  BaseDef,
  Format,
  Field,
  CardContext,
  CardCrudFunctions,
} from '@cardstack/base/card-api';

interface Signature {
  Element: any;
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
    codeRef?: ResolvedCodeRef;
    displayContainer?: boolean;
    execution?: 'auto' | 'direct';
  };
}

export default class CardRenderer extends Component<Signature> {
  @service declare private directBoxelRuntime: DirectBoxelRuntimeService;

  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(GetCardsContextName) declare private getCards: getCards;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @consume(CardContextName) declare private cardContext: CardContext;
  @consume(CardCrudFunctionsContextName)
  declare private cardCrudFunctions: CardCrudFunctions | undefined;

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormat is declared but not used"
  get defaultFormat() {
    let { format } = this.args;
    format = format ?? 'isolated';
    return { cardDef: format, fieldDef: format };
  }

  @provide(CardURLContextName)
  // @ts-ignore "cardURL is declared but not used"
  private get cardURL() {
    return 'id' in this.args.card
      ? (this.args.card?.id as string | undefined)
      : undefined;
  }

  <template>
    {{#if this.usesExecutionRuntime}}
      <BoxelExecutionRenderer
        @card={{@card}}
        @format={{@format}}
        @displayContainer={{@displayContainer}}
        @viewCard={{this.viewCard}}
        ...attributes
      />
    {{else if (eq @format 'head')}}
      <HeadFormatPreview
        @renderedCard={{this.renderedCard}}
        @cardURL={{this.cardURL}}
      />
    {{else}}
      <this.renderedCard
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    {{/if}}
  </template>

  get renderedCard() {
    return this.directBoxelRuntime.runtime.getRenderSlot(
      this.args.card,
      this.args.field,
      this.args.codeRef ? { componentCodeRef: this.args.codeRef } : undefined,
    ).component;
  }

  private get viewCard() {
    return this.cardCrudFunctions?.viewCard;
  }

  private get usesExecutionRuntime(): boolean {
    return (
      this.args.execution === 'auto' &&
      this.args.field === undefined &&
      this.args.codeRef === undefined
    );
  }
}
