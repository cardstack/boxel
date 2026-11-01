import { copyCardURLToClipboard } from '@cardstack/boxel-ui/helpers';

import type { VirtualNetwork } from '@cardstack/runtime-common';

// The URL a browser can open for an id. An id in a prefix-mapped realm reads
// `@scope/name/...`, which only the module loader understands.
export function openableURL(id: string, virtualNetwork: VirtualNetwork) {
  try {
    return virtualNetwork.toURLHref(id);
  } catch {
    return id;
  }
}

export function copyOpenableURLToClipboard(
  id: string,
  virtualNetwork: VirtualNetwork,
): Promise<void> {
  return copyCardURLToClipboard(openableURL(id, virtualNetwork));
}
