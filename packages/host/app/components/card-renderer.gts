import Component from '@glimmer/component';

import { provide, consume } from 'ember-provide-consume-context';

import { eq } from '@cardstack/boxel-ui/helpers';

import { modifier } from 'ember-modifier';
import { tracked } from '@glimmer/tracking';
import {
  CardContextName,
  DefaultFormatsContextName,
  CardURLContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  ResolvedCodeRef,
  type getCard,
  type getCards,
  type getCardCollection,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  Format,
  Field,
  CardContext,
} from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: any;
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
    codeRef?: ResolvedCodeRef;
    displayContainer?: boolean;
  };
}

export default class CardRenderer extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;
  @consume(CardContextName) private declare cardContext: CardContext;

  @tracked private headMarkup = '';

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

  captureHeadMarkup = modifier((element: HTMLElement) => {
    this.headMarkup = element.innerHTML.trim();
  });

  setHeadPreview = modifier((element: HTMLElement, [markup]: [string]) => {
    element.textContent = markup ?? '';
  });

  <template>
    {{! TODO: replace this hackish HTML preview in CS-9782 }}
    {{#if (eq @format 'head')}}
      <div hidden aria-hidden='true' {{this.captureHeadMarkup}}>
        <this.renderedCard @displayContainer={{false}} />
      </div>
      <pre {{this.setHeadPreview this.headMarkup}}></pre>
    {{else}}
      <this.renderedCard
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    {{/if}}
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.field,
      this.args.codeRef ? { componentCodeRef: this.args.codeRef } : undefined,
    );
  }
}
