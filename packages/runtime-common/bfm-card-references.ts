import { escapeHtml } from './helpers/html';
import { resolveCardReference } from './card-reference-resolver';
import type { TokenizerAndRendererExtension } from 'marked';

// Regex patterns for stripping code before extraction.
// These avoid backtick-in-regex issues that break content-tag in .gts files.
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;

function resolveUrl(ref: string, baseUrl: string | undefined): string | null {
  try {
    return resolveCardReference(ref, baseUrl || undefined);
  } catch {
    return null;
  }
}

export interface BfmReference {
  url: string;
  keyword: string;
}

/**
 * Extracts and deduplicates BFM reference URLs from markdown content for the
 * given keywords (e.g. 'card', 'file'). Supports `:keyword[URL]` (inline) and
 * `::keyword[URL]` (block) syntax. References inside fenced code blocks and
 * inline code are ignored. Returns resolved absolute URLs in document order.
 */
export function extractBfmReferences(
  markdown: string,
  baseUrl: string,
  keywords: string[],
): BfmReference[] {
  // Strip code blocks so references inside them are not extracted
  let stripped = markdown
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '');

  let seen = new Set<string>();
  let refs: BfmReference[] = [];

  for (let keyword of keywords) {
    let blockRe = new RegExp(`^::${keyword}\\[([^\\]]+)\\]`, 'gm');
    // Negative lookbehind excludes ::keyword[ (block syntax) from inline matches
    let inlineRe = new RegExp(`(?<!:):${keyword}\\[([^\\]]+)\\]`, 'g');

    for (let match of stripped.matchAll(blockRe)) {
      let resolved = resolveUrl(match[1], baseUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        refs.push({ url: resolved, keyword });
      }
    }
    for (let match of stripped.matchAll(inlineRe)) {
      let resolved = resolveUrl(match[1], baseUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        refs.push({ url: resolved, keyword });
      }
    }
  }

  return refs;
}

/**
 * Convenience wrapper that extracts only `:card[URL]` / `::card[URL]`
 * references and returns just the resolved URL strings.
 */
export function extractCardReferenceUrls(
  markdown: string,
  baseUrl: string,
): string[] {
  return extractBfmReferences(markdown, baseUrl, ['card']).map((r) => r.url);
}

/**
 * Creates marked v12 extensions for a given BFM keyword.
 *
 * Block: `::keyword[URL]` → `<div data-boxel-bfm-block-ref="URL" data-boxel-bfm-type="keyword"></div>`
 * Inline: `:keyword[URL]` → `<span data-boxel-bfm-inline-ref="URL" data-boxel-bfm-type="keyword"></span>`
 *
 * URLs are emitted as-is (unresolved). The consumer is responsible for
 * resolving them against a base URL before matching to instance IDs.
 */
export function bfmExtensionsForKeyword(
  keyword: string,
): TokenizerAndRendererExtension[] {
  let blockType = `bfm${capitalize(keyword)}Block`;
  let inlineType = `bfm${capitalize(keyword)}Inline`;
  let colonKeyword = `:${keyword}[`;
  let doubleColonKeyword = `::${keyword}[`;

  return [
    {
      name: blockType,
      level: 'block',
      start(src: string) {
        let re = new RegExp(`^${escapeRegExp(doubleColonKeyword)}`, 'm');
        let match = src.match(re);
        return match?.index;
      },
      tokenizer(src: string) {
        let re = new RegExp(
          `^::${escapeRegExp(keyword)}\\[([^\\]]+)\\]\\s*(?:\\n|$)`,
        );
        let match = src.match(re);
        if (match) {
          return {
            type: blockType,
            raw: match[0],
            url: match[1],
          };
        }
        return undefined;
      },
      renderer(token) {
        let url = escapeHtml((token as any).url);
        return `<div data-boxel-bfm-block-ref="${url}" data-boxel-bfm-type="${keyword}">${url}</div>\n`;
      },
    },
    {
      name: inlineType,
      level: 'inline',
      start(src: string) {
        let idx = 0;
        while (idx < src.length) {
          let pos = src.indexOf(colonKeyword, idx);
          if (pos === -1) return undefined;
          // Skip if preceded by ':' (block syntax ::keyword[)
          if (pos > 0 && src[pos - 1] === ':') {
            idx = pos + 1;
            continue;
          }
          return pos;
        }
        return undefined;
      },
      tokenizer(src: string) {
        let re = new RegExp(`^:${escapeRegExp(keyword)}\\[([^\\]]+)\\]`);
        let match = src.match(re);
        if (match) {
          return {
            type: inlineType,
            raw: match[0],
            url: match[1],
          };
        }
        return undefined;
      },
      renderer(token) {
        let url = escapeHtml((token as any).url);
        return `<span data-boxel-bfm-inline-ref="${url}" data-boxel-bfm-type="${keyword}">${url}</span>`;
      },
    },
  ];
}

/**
 * Returns marked extensions for the default set of BFM keywords.
 * Currently registers 'card'. Add new keywords here as they are introduced.
 */
export function bfmCardReferenceExtensions(): TokenizerAndRendererExtension[] {
  return bfmExtensionsForKeyword('card');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
