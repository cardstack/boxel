import { htmlSafe, type SafeString } from '@ember/template';
import { sanitizeHtml } from '@cardstack/runtime-common';

// TODO: move this to runtime-common (issue: can't resolve "@ember/template")
export function sanitizedHtml(html?: string): SafeString {
  return htmlSafe(sanitizeHtml(html ?? ''));
}
