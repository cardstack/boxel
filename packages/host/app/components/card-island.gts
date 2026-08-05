import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import {
  CardContextName,
  CardCrudFunctionsContextName,
  CardURLContextName,
  DefaultFormatsContextName,
  GetCardCollectionContextName,
  GetCardContextName,
  GetCardsContextName,
  type getCard,
  type getCardCollection,
  type getCards,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type {
  BaseDef,
  CardContext,
  CardCrudFunctions,
  Format,
} from '@cardstack/base/card-api';

export interface CardIslandArgs {
  card: BaseDef;
  format: Format;
  getCard: getCard;
  getCards: getCards;
  getCardCollection: getCardCollection;
  context: CardContext;
  cardCrudFunctions?: CardCrudFunctions;
  displayContainer?: boolean;
}

interface Signature {
  Element: HTMLElement;
  Args: CardIslandArgs;
}

// This component is the shared Glimmer boundary for server serialization and
// client rehydration. Keeping context providers and CardRenderer inside the
// boundary makes the rendered program identical without hydrating the host
// application around it.
export default class CardIsland extends Component<Signature> {
  @provide(GetCardContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get getCard() {
    return this.args.getCard;
  }

  @provide(GetCardsContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get getCards() {
    return this.args.getCards;
  }

  @provide(GetCardCollectionContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get getCardCollection() {
    return this.args.getCardCollection;
  }

  @provide(CardContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get context() {
    return this.args.context;
  }

  @provide(CardCrudFunctionsContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get cardCrudFunctions() {
    return this.args.cardCrudFunctions;
  }

  @provide(DefaultFormatsContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get defaultFormats() {
    return { cardDef: this.args.format, fieldDef: this.args.format };
  }

  @provide(CardURLContextName)
  // @ts-expect-error provided values are consumed from the template subtree
  private get cardURL() {
    return 'id' in this.args.card
      ? (this.args.card.id as string | undefined)
      : undefined;
  }

  <template>
    <CardRenderer
      @card={{@card}}
      @format={{@format}}
      @displayContainer={{@displayContainer}}
    />
  </template>
}
