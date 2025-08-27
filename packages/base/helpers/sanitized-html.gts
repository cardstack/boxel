import { htmlSafe, type SafeString } from '@ember/template';

import { sanitizeHtml } from '@cardstack/runtime-common';

export default function sanitizedHtml(html?: string): SafeString {
  if (!html) {
    return htmlSafe('');
  }
  return htmlSafe(sanitizeHtml(html));
}
