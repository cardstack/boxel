// Resolves to whether the URL reached the clipboard.
export async function copyCardURLToClipboard(
  card: { id: string } | URL | string,
): Promise<boolean> {
  let copyableUrl;
  if (typeof card === 'string') {
    copyableUrl = card;
  } else if (card instanceof URL) {
    copyableUrl = card.href;
  } else {
    copyableUrl = card.id;
  }
  if (!copyableUrl) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(copyableUrl);
    return true;
  } catch (error) {
    // A menu action has no caller to hand this to: the write fails when the
    // page has lost focus or the clipboard permission is denied.
    console.warn(`Could not copy ${copyableUrl} to the clipboard`, error);
    return false;
  }
}
