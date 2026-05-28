import { escapeHtml } from './helpers/html';
import { resolveCardReference } from './card-reference-resolver';
import type { VirtualNetwork } from './virtual-network';
import { trimJsonExtension } from './url';
import { FITTED_FORMATS } from './formats';
import type { TokenizerAndRendererExtension } from './marked.mts';

// Regex patterns for stripping code before extraction.
// These avoid backtick-in-regex issues that break content-tag in .gts files.
const FENCED_CODE_RE = /```[\s\S]*?```/g;
// Match code spans with any number of consecutive backticks as delimiter
// (e.g. `code`, ``code``, ```code```).
const INLINE_CODE_RE = new RegExp('(`+)([\\s\\S]*?)\\1', 'g');

function resolveUrl(
  ref: string,
  baseUrl: string | undefined,
  virtualNetwork?: VirtualNetwork,
): string | null {
  try {
    return virtualNetwork
      ? virtualNetwork.resolveURL(ref, baseUrl || undefined).href
      : resolveCardReference(ref, baseUrl || undefined);
  } catch {
    return null;
  }
}

// ── BFM size spec parsing ──

export interface BfmSizeSpec {
  format: 'fitted' | 'isolated' | 'embedded';
  width?: number | string; // number = px, string = e.g. "50%"
  height?: number;
}

// Build a flat lookup from FITTED_FORMATS canonical IDs → dimensions
const SIZE_CONSTANTS = new Map<string, { width: number; height: number }>();
for (const group of FITTED_FORMATS) {
  for (const spec of group.specs) {
    SIZE_CONSTANTS.set(spec.id, { width: spec.width, height: spec.height });
  }
}
// BFM spec shorthand aliases → canonical IDs
SIZE_CONSTANTS.set('strip', SIZE_CONSTANTS.get('single-strip')!);
SIZE_CONSTANTS.set('tile', SIZE_CONSTANTS.get('regular-tile')!);
SIZE_CONSTANTS.set('grid-tile', SIZE_CONSTANTS.get('cardsgrid-tile')!);

/**
 * Parses a BFM size specifier (the part after `|` in `::card[url | spec]`).
 *
 * Supported forms:
 *  - `isolated`                          — isolated format
 *  - `embedded`                          — embedded format (explicit)
 *  - `fitted`                            — fitted at the container's natural size
 *  - Named constant: `strip`, `tile`, `compact-card`, etc. (fitted implied)
 *  - `fitted <named-constant>`           — e.g. `fitted strip` (same as `strip`)
 *  - WxH: `400x200` (fitted implied)
 *  - `fitted <WxH>`                      — e.g. `fitted 400x200` (same as `400x200`)
 *  - Explicit keys: `w:400 h:200`, `h:300`, `w:50%` (fitted implied)
 */
export function parseBfmSizeSpec(specifier: string): BfmSizeSpec | null {
  let trimmed = specifier.trim().toLowerCase();

  if (trimmed === 'isolated') {
    return { format: 'isolated' };
  }

  if (trimmed === 'embedded') {
    return { format: 'embedded' };
  }

  if (trimmed === 'fitted') {
    return { format: 'fitted' };
  }

  // Strip optional `fitted` prefix followed by any whitespace;
  // everything below already implies fitted.
  let body = trimmed.replace(/^fitted\s+/, '');

  // Named size constant
  let constant = SIZE_CONSTANTS.get(body);
  if (constant) {
    return { format: 'fitted', width: constant.width, height: constant.height };
  }

  // WxH (e.g. "400x200")
  let wxhMatch = body.match(/^(\d+)\s*x\s*(\d+)$/);
  if (wxhMatch) {
    return {
      format: 'fitted',
      width: parseInt(wxhMatch[1], 10),
      height: parseInt(wxhMatch[2], 10),
    };
  }

  // Explicit key syntax: w:N, h:N, w:N%
  let wMatch = body.match(/\bw:(\d+)(%?)/);
  let hMatch = body.match(/\bh:(\d+)\b/);

  if (wMatch || hMatch) {
    let spec: BfmSizeSpec = { format: 'fitted' };
    if (wMatch) {
      spec.width =
        wMatch[2] === '%' ? `${wMatch[1]}%` : parseInt(wMatch[1], 10);
    }
    if (hMatch) {
      spec.height = parseInt(hMatch[1], 10);
    }
    return spec;
  }

  return null;
}

export type BfmBlockFormat = 'embedded' | 'fitted' | 'isolated';

/**
 * Derives the block-level render format and an optional inline sizing style
 * (`width`/`height`) from a BFM block-ref element's `data-boxel-bfm-*`
 * attributes. Shared so that resolved cards, the loading shimmer, and the
 * broken-link placeholder all occupy the same footprint as the eventual card.
 */
export function bfmBlockFormatAndSize(
  formatAttr: string | undefined,
  widthAttr: string | undefined,
  heightAttr: string | undefined,
): { format: BfmBlockFormat; sizeStyle?: string } {
  let format: BfmBlockFormat =
    formatAttr === 'fitted' || formatAttr === 'isolated'
      ? formatAttr
      : 'embedded';
  if (format !== 'fitted') {
    return { format };
  }
  let parts: string[] = [];
  if (widthAttr && /^\d+%$/.test(widthAttr)) {
    parts.push(`width: ${widthAttr}`);
  } else if (widthAttr && /^\d+$/.test(widthAttr)) {
    parts.push(`width: ${widthAttr}px`);
  }
  if (heightAttr && /^\d+$/.test(heightAttr)) {
    parts.push(`height: ${heightAttr}px`);
  }
  return { format, sizeStyle: parts.length ? parts.join('; ') : undefined };
}

/**
 * Splits the content between `[` and `]` in a BFM directive into the URL
 * part and an optional size specifier (after `|`).
 */
function splitBfmContent(content: string): {
  url: string;
  specifier: string | undefined;
} {
  let pipeIndex = content.indexOf('|');
  if (pipeIndex >= 0) {
    return {
      url: content.substring(0, pipeIndex).trim(),
      specifier: content.substring(pipeIndex + 1).trim(),
    };
  }
  return { url: content.trim(), specifier: undefined };
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
  virtualNetwork?: VirtualNetwork,
): BfmReference[] {
  // Strip code blocks so references inside them are not extracted
  let stripped = markdown
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '');

  // Collect all matches with their position so we can sort by document order
  let matches: { index: number; url: string; keyword: string }[] = [];

  for (let keyword of keywords) {
    let blockRe = new RegExp(`^::${keyword}\\[([^\\]]+)\\]`, 'gm');
    // Negative lookbehind excludes ::keyword[ (block syntax) from inline matches
    let inlineRe = new RegExp(`(?<!:):${keyword}\\[([^\\]]+)\\]`, 'g');

    for (let match of stripped.matchAll(blockRe)) {
      let { url: rawUrl } = splitBfmContent(match[1]);
      let resolved = resolveUrl(rawUrl, baseUrl, virtualNetwork);
      if (resolved) {
        matches.push({
          index: match.index!,
          url: trimJsonExtension(resolved),
          keyword,
        });
      }
    }
    for (let match of stripped.matchAll(inlineRe)) {
      let resolved = resolveUrl(match[1], baseUrl, virtualNetwork);
      if (resolved) {
        matches.push({
          index: match.index!,
          url: trimJsonExtension(resolved),
          keyword,
        });
      }
    }
  }

  // Sort by position in the document, then deduplicate by URL (keeping first)
  matches.sort((a, b) => a.index - b.index);

  let seen = new Set<string>();
  let refs: BfmReference[] = [];
  for (let m of matches) {
    if (!seen.has(m.url)) {
      seen.add(m.url);
      refs.push({ url: m.url, keyword: m.keyword });
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
  virtualNetwork?: VirtualNetwork,
): string[] {
  return extractBfmReferences(markdown, baseUrl, ['card'], virtualNetwork).map(
    (r) => r.url,
  );
}

/**
 * Creates marked v12 extensions for a given BFM keyword.
 *
 * Block: `::keyword[URL]` → `<div data-boxel-bfm-block-ref="URL" data-boxel-bfm-type="keyword">URL</div>`
 * Inline: `:keyword[URL]` → `<span data-boxel-bfm-inline-ref="URL" data-boxel-bfm-type="keyword">URL</span>`
 *
 * The URL text content serves as fallback text shown before referenced cards
 * load or when they cannot be resolved. URLs are emitted as-is (unresolved).
 * The consumer is responsible for resolving them against a base URL before
 * matching to instance IDs.
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
          let { url, specifier } = splitBfmContent(match[1]);
          return {
            type: blockType,
            raw: match[0],
            url,
            specifier,
          };
        }
        return undefined;
      },
      renderer(token) {
        let url = escapeHtml((token as any).url);
        let specifier: string | undefined = (token as any).specifier;
        let attrs = `data-boxel-bfm-block-ref="${url}" data-boxel-bfm-type="${keyword}"`;

        if (specifier) {
          let sizeSpec = parseBfmSizeSpec(specifier);
          if (sizeSpec) {
            attrs += ` data-boxel-bfm-format="${sizeSpec.format}"`;
            if (sizeSpec.width !== undefined) {
              attrs += ` data-boxel-bfm-width="${sizeSpec.width}"`;
            }
            if (sizeSpec.height !== undefined) {
              attrs += ` data-boxel-bfm-height="${sizeSpec.height}"`;
            }
          }
        }

        return `<div ${attrs}>${url}</div>\n`;
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

/**
 * Extracts a human-readable card type name from a card URL or path.
 *
 * Card URLs follow the pattern `<base>/<TypeName>/<id>`, so the type name is
 * the second-to-last path segment. The last segment is typically a UUID or
 * slug and is not human-readable.
 *
 * Examples:
 *  - `https://example.com/Pet/a3b2c1d4-...` → `"Pet"`
 *  - `./Author/jane-doe`                    → `"Author"`
 *  - `./BlogPost/some-id.json`              → `"BlogPost"`
 *  - `./Foo`                                → `"Foo"`
 *  - `""`                                   → `"Card"`
 */
export function cardTypeName(url: string): string {
  let path = url;

  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; treat as a path/reference string.
  }

  let cleaned = path
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '')
    .replace(/\.json$/, '');
  let segments = cleaned.split('/').filter((s) => s && s !== '.' && s !== '..');
  if (segments.length >= 2) {
    return segments[segments.length - 2];
  }
  if (segments.length === 1) {
    return segments[0];
  }
  return 'Card';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
