// Browser-only HTML-to-markdown conversion used by the default `static markdown`
// fallback template on `CardDef`/`FieldDef`/`FileDef` (CS-10784).
//
// SECURITY / BUNDLING CONSTRAINT
// ------------------------------
// Card code must not run on the server; the prerender pipeline already runs
// in a headless browser, so this module is safe to execute there. This file
// lives in `packages/host` and must NOT be imported by `packages/realm-server`
// or any other Node.js code path. The base realm's default template reaches
// this converter via `globalThis.__boxelHtmlToMarkdown`, so `packages/base`
// never imports turndown either — the dependency is fully contained to the
// host/browser bundle.

import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';

let converter: TurndownService | undefined;

function getConverter(): TurndownService {
  if (!converter) {
    converter = new TurndownService({
      headingStyle: 'atx', // `# H1` instead of setext underlines — single-line
      codeBlockStyle: 'fenced', // ```lang blocks
      bulletListMarker: '-',
      emDelimiter: '_',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });
    converter.use(gfm); // tables, strikethrough, task lists, autolinks
  }
  return converter;
}

export function convertHtmlToMarkdown(html: string): string {
  if (!html) {
    return '';
  }
  return getConverter().turndown(html);
}

// Register a synchronous converter on `globalThis` so base-realm templates
// (which cannot statically import from `packages/host`) can invoke it at
// render time. Using `??=` so re-imports are idempotent and test harnesses
// that install their own stub are not overwritten.
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__boxelHtmlToMarkdown ??= convertHtmlToMarkdown;
}

export default convertHtmlToMarkdown;
