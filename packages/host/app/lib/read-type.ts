import type { StoreReadType } from '@cardstack/runtime-common';
import { hasExtension } from '@cardstack/runtime-common/url';

export function isFileMetaId(id: string | null | undefined): boolean {
  if (!id) {
    return false;
  }
  return hasExtension(id) && !id.endsWith('.json');
}

export function inferStoreReadType(
  id: string | null | undefined,
): StoreReadType {
  return isFileMetaId(id) ? 'file-meta' : 'card';
}
