import type { StoreReadType } from '@cardstack/runtime-common';
import { hasExtension } from '@cardstack/runtime-common/url';

export function inferStoreReadType(
  id: string | null | undefined,
): StoreReadType {
  if (!id) {
    return 'card';
  }
  return hasExtension(id) && !id.endsWith('.json') ? 'file-meta' : 'card';
}
