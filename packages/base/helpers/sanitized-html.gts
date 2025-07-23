import { htmlSafe, type SafeString } from '@ember/template';

import { sanitizeHtml } from '@cardstack/runtime-common';

export function sanitizedHtml(html?: string): SafeString {
  return htmlSafe(sanitizeHtml(html ?? ''));
}
