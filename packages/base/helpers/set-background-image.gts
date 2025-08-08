import type { SafeString } from '@ember/template';

import sanitizedHtml from './sanitized-html';

export default function setBackgroundImage(
  backgroundURL?: string | null,
): SafeString | undefined {
  if (!backgroundURL) {
    return;
  }
  return sanitizedHtml(`background-image: url(${backgroundURL});`);
}
