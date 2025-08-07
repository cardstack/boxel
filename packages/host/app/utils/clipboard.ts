import config from '@cardstack/host/config/environment';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export async function copyCardURLToClipboard(
  card: CardDef | URL | string,
): Promise<void> {
  let copyableUrl;
  if (typeof card === 'string') {
    copyableUrl = card;
  } else if (card instanceof URL) {
    copyableUrl = card.href;
  } else {
    copyableUrl = card.id;
  }
  if (!copyableUrl) {
    return;
  }
  if (config.environment === 'test') {
    return; // navigator.clipboard is not available in test environment
  }
  await navigator.clipboard.writeText(copyableUrl);
}
