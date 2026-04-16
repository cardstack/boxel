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
    converter.remove(['style', 'script']); // strip embedded CSS/JS from card HTML

    // Embedded card containers should become card references rather than having
    // their full HTML content inlined into the markdown.  Atom-format cards
    // use the inline directive `:card[id]`; other formats (fitted, embedded)
    // use the block directive `::card[id]`.
    converter.addRule('cardContainer', {
      filter(node) {
        return (
          node.nodeType === Node.ELEMENT_NODE &&
          (node as HTMLElement).hasAttribute('data-boxel-card-id')
        );
      },
      replacement(_content, node) {
        let cardId = (node as HTMLElement).getAttribute('data-boxel-card-id');
        if (!cardId) {
          return _content;
        }
        let format = (node as HTMLElement).getAttribute(
          'data-boxel-card-format',
        );
        if (format === 'atom') {
          return `:card[${cardId}]`;
        }
        return `::card[${cardId}]`;
      },
    });

    // Card HTML often wraps link text in nested elements (icons, spans) with
    // whitespace between them.  Turndown preserves that whitespace, producing
    // multiline `[\n  Contact](url)` which is broken markdown.  Collapse it.
    converter.addRule('compactLinks', {
      filter: 'a',
      replacement(_content, node, options) {
        let href = (node as HTMLAnchorElement).getAttribute('href');
        if (!href) {
          return _content;
        }
        let text = _content.replace(/\s+/g, ' ').trim();
        if (!text) {
          return '';
        }
        let title = (node as HTMLAnchorElement).getAttribute('title');
        let titlePart = title ? ` "${title}"` : '';
        return `[${text}](${href}${titlePart})`;
      },
    });
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
