import { ResolvedCodeRef } from '@cardstack/runtime-common';

export function getCodeRefFromSearchKey(
  searchKey: string,
): ResolvedCodeRef | undefined {
  if (searchKey.startsWith('carddef:')) {
    let internalKey = searchKey.substring('carddef:'.length);
    let parts = internalKey.split('/');
    let name = parts.pop()!;
    let module = parts.join('/');
    return { module, name };
  }
  return undefined;
}

export function removeFileExtension(cardId: string) {
  return cardId?.replace(/\.[^/.]+$/, '');
}
