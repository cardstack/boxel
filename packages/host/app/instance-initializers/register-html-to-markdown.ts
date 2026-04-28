import type ApplicationInstance from '@ember/application/instance';

// Importing the module for its side effect: `html-to-markdown.ts` registers
// `globalThis.__boxelHtmlToMarkdown` at module-evaluation time so base-realm
// templates (which cannot statically import from `packages/host`) can reach
// the converter. The initializer exists to guarantee the module is in the
// boot-time dependency graph — without it, the module would only be pulled
// in when something else happens to import it first, which could race with
// early markdown renders during prerender.
import '../lib/html-to-markdown';

export function initialize(_appInstance: ApplicationInstance): void {
  // No-op: the global is installed by the import above.
}

export default {
  initialize,
};
