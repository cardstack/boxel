import type { CodeRef } from '@cardstack/runtime-common';

export interface NewCardArgs {
  ref: CodeRef;
  relativeTo: string | undefined;
  realmURL: string;
}

export function removeFileExtension(cardId: string | undefined) {
  return cardId?.replace(/\.[^/.]+$/, '');
}
