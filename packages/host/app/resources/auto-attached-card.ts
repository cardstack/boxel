import { tracked } from '@glimmer/tracking';

import { Resource } from 'ember-resources';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    lastTopMostCard: CardDef | undefined;
    attachedCards: CardDef[] | undefined;
  };
}

export class AutoAttachment extends Resource<Args> {
  @tracked card: CardDef | undefined;
  private lastCard: CardDef | undefined;

  modify(_positional: never[], named: Args['named']) {
    const { lastTopMostCard, attachedCards } = named;
    if (lastTopMostCard === undefined) {
      this.card = undefined;
      this.lastCard = undefined;
      return;
    }
    if (
      this.isAlreadyAttached(lastTopMostCard, attachedCards) ||
      this.wasPreviouslyCleared(lastTopMostCard)
    ) {
      this.card = undefined;
      return;
    }
    this.card = lastTopMostCard;
  }

  private isAlreadyAttached(
    lastTopMostCard: CardDef,
    attachedCards: CardDef[] | undefined,
  ) {
    if (attachedCards === undefined) {
      return false;
    }
    return attachedCards?.some((c) => c.id === lastTopMostCard.id);
  }

  private wasPreviouslyCleared(lastTopMostCard: CardDef) {
    if (this.lastCard === undefined) {
      return false;
    }
    return this.lastCard.id === lastTopMostCard.id;
  }

  clear() {
    this.lastCard = this.card;
    this.card = undefined;
  }
}

export function getAutoAttachment(
  parent: object,
  lastTopMostCard: () => CardDef | undefined,
  attachedCards: () => CardDef[] | undefined,
) {
  return AutoAttachment.from(parent, () => ({
    named: {
      lastTopMostCard: lastTopMostCard(),
      attachedCards: attachedCards(),
    },
  }));
}
