import { copyCardURLToClipboard } from '@cardstack/boxel-ui/helpers';

import type { VirtualNetwork } from '@cardstack/runtime-common';

// Copies the URL a browser can open for an id, by the same rule card code's
// stores use (`CardStore.openableURL`).
export function copyOpenableURLToClipboard(
  id: string,
  virtualNetwork: VirtualNetwork,
): Promise<void> {
  return copyCardURLToClipboard(virtualNetwork.keyForIdentifier(id));
}
