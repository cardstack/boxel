import { isTesting } from '@embroider/macros';

export async function copyCardURLToClipboard(
  card: { id: string } | URL | string,
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
  if (isTesting()) {
    return; // navigator.clipboard is not available in test environment
  }
  await navigator.clipboard.writeText(copyableUrl);
}
