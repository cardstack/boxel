import { htmlSafe, type SafeString } from '@ember/template';

import { sanitizeHtml } from '@cardstack/runtime-common';

export default function sanitizedHtml(html?: string): SafeString | undefined {
  if (!html) {
    return;
  }
  return htmlSafe(sanitizeHtml(html));
}
