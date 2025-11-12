import {
  loadCardDef,
  type Loader,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export type CardRenderContext = {
  cardId?: string;
  nonce?: string;
};

function contextKey({ cardId, nonce }: CardRenderContext): string {
  return `${cardId ?? ''}|${nonce ?? ''}`;
}

export class RenderCardTypeTracker {
  #cardTypes = new Map<string, string>();

  get(context: CardRenderContext) {
    return this.#cardTypes.get(contextKey(context));
  }

  set(context: CardRenderContext, cardType?: string) {
    let key = contextKey(context);
    if (!cardType) {
      this.#cardTypes.delete(key);
    } else {
      this.#cardTypes.set(key, cardType);
    }
  }

  clear() {
    this.#cardTypes.clear();
  }
}

export function friendlyCardType(card: typeof CardDef): string {
  return card.displayName === 'Card' ? card.name : card.displayName;
}

export async function deriveCardTypeFromDoc(
  doc: LooseSingleCardDocument,
  cardURL: string,
  loader: Loader,
): Promise<string | undefined> {
  let adoptsFrom = doc.data?.meta?.adoptsFrom;
  if (!adoptsFrom) {
    return undefined;
  }
  let cardDef = await loadCardDef(adoptsFrom, {
    loader,
    relativeTo: new URL(cardURL),
  });
  return friendlyCardType(cardDef as typeof CardDef);
}

export function withCardType<T extends object>(
  payload: T,
  cardType?: string,
): T & { cardType?: string } {
  if (!cardType || 'cardType' in (payload as Record<string, unknown>)) {
    return payload as T & { cardType?: string };
  }
  return {
    ...(payload as object),
    cardType,
  } as T & { cardType?: string };
}
