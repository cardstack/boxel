import { tracked } from '@glimmer/tracking';
import { Resource } from 'ember-modify-based-class-resource';
import { type CodeRef, loadCardDef } from '@cardstack/runtime-common';
import { BaseDef } from 'https://cardstack.com/base/card-api';

interface CardDefLoaderArgs {
  named: {
    cardTypeRef?: CodeRef;
    realm?: string;
  };
}

class CardDefLoaderResource extends Resource<CardDefLoaderArgs> {
  @tracked value: typeof BaseDef | null = null;
  @tracked isLoading = false;
  @tracked error: Error | null = null;

  modify(_positional: never[], named: CardDefLoaderArgs['named']) {
    const { cardTypeRef, realm } = named;
    if (!cardTypeRef || !realm) {
      this.value = null;
      this.isLoading = false;
      this.error = null;
      return;
    }

    this.loadCardDef(cardTypeRef, realm);
  }

  private async loadCardDef(cardTypeRef: CodeRef, realm?: string) {
    this.isLoading = true;
    this.error = null;

    try {
      const def = await loadCardDef(cardTypeRef, {
        loader: (import.meta as any).loader,
        relativeTo: realm ? new URL(realm) : undefined,
      });
      this.value = def;
    } catch (error) {
      console.error('Failed to load card definition:', error);
      this.error = error as Error;
      this.value = null;
    } finally {
      this.isLoading = false;
    }
  }
}

export function cardDefLoader(
  parent: object,
  cardTypeRef: () => CodeRef | undefined,
  realm?: () => string | undefined,
) {
  return CardDefLoaderResource.from(parent, () => ({
    named: {
      cardTypeRef: cardTypeRef(),
      realm: realm?.(),
    },
  }));
}
